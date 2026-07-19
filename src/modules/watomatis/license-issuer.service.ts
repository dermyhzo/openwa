import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MessageService } from '../message/message.service';
import { SessionService } from '../session/session.service';
import { Session, SessionStatus } from '../session/entities/session.entity';
import { WatomatisSettingsStore } from './watomatis-settings-store.service';
import { ScalevConnector, PAID_STATUSES } from './connectors/scalev.connector';
import { signLicenseKey } from '../license/license-key';

const POLL_MS = 5 * 60_000;
const FIRST_RUN_MS = 30_000;
// The seller's own Scalev product for Watomatis; only orders containing it get a license.
const PRODUCT_ID = process.env.WATOMATIS_LICENSE_PRODUCT_ID ?? '425339';

interface IssuedRecord {
  phone: string;
  key: string;
  sentAt: string | null;
  /** true when the order was checked and does NOT contain the Watomatis product (skip forever). */
  notOurs?: boolean;
}

/**
 * SELLER-SIDE auto-delivery: polls Scalev for paid Watomatis orders, signs a license key for
 * each, and sends it to the buyer's WhatsApp via the connected session. Dormant on buyer
 * installs: it only runs when the issuer PRIVATE key (data/license-issuer.key) exists, which
 * never ships. Unsent keys (e.g. WhatsApp disconnected) are retried on the next poll.
 */
@Injectable()
export class LicenseIssuerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LicenseIssuer');
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstRun: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly settings: WatomatisSettingsStore,
    private readonly scalev: ScalevConnector,
    private readonly sessions: SessionService,
    private readonly messages: MessageService,
  ) {}

  private get dataDir(): string {
    return process.env.WATOMATIS_DATA_DIR ?? path.resolve('data', 'watomatis');
  }
  private get issuerKeyPath(): string {
    return path.join(this.dataDir, '..', 'license-issuer.key');
  }
  private get ledgerPath(): string {
    return path.join(this.dataDir, 'issued-licenses.json');
  }

  onModuleInit(): void {
    this.firstRun = setTimeout(() => void this.tick(), FIRST_RUN_MS);
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
  }

  /** One poll cycle. Public so an operator can trigger it via the controller for testing. */
  async tick(): Promise<{ issued: number; sent: number } | { skipped: string }> {
    if (this.running) return { skipped: 'busy' };
    this.running = true;
    try {
      return await this.run();
    } catch (err) {
      this.logger.error('License issuer tick failed', err as Error);
      return { skipped: 'error' };
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<{ issued: number; sent: number } | { skipped: string }> {
    const issuerPem = await fs.readFile(this.issuerKeyPath, 'utf8').catch(() => null);
    if (!issuerPem) return { skipped: 'no issuer key (buyer instance)' };

    const sc = (await this.settings.get()).scalev;
    if (!sc.enabled || !sc.apiKey || !sc.storeUniqueId) return { skipped: 'scalev not configured' };

    const ledger = await this.readLedger();
    const orders = await this.scalev.listRecentOrders(sc.apiKey);
    let issued = 0;
    let sent = 0;

    for (const o of orders) {
      if (!PAID_STATUSES.has(o.status)) continue;
      let rec = ledger[o.orderId];
      if (rec?.notOurs || rec?.sentAt) continue;

      if (!rec) {
        const detail = await this.scalev.orderProduct(sc.apiKey, o.orderId, PRODUCT_ID);
        if (!detail.contains) {
          ledger[o.orderId] = { phone: '', key: '', sentAt: null, notOurs: true };
          continue;
        }
        const phone = (detail.phone || o.phone).replace(/\D/g, '');
        if (!phone) {
          this.logger.warn(`Paid Watomatis order ${o.orderId} has no phone; cannot deliver license automatically`);
          continue;
        }
        const key = signLicenseKey(
          { v: 1, t: 'lifetime', p: phone, o: o.orderId, iat: Math.floor(Date.now() / 1000) },
          issuerPem,
        );
        rec = { phone, key, sentAt: null };
        ledger[o.orderId] = rec;
        issued++;
        this.logger.log(`Issued license for paid order ${o.orderId} (…${phone.slice(-4)})`);
      }

      if (!rec.sentAt && (await this.trySend(rec))) {
        rec.sentAt = new Date().toISOString();
        sent++;
      }
    }

    await this.writeLedger(ledger);
    if (issued || sent) this.logger.log(`License issuer: issued=${issued} sent=${sent}`);
    return { issued, sent };
  }

  private async trySend(rec: IssuedRecord): Promise<boolean> {
    const all = await this.sessions.findAll().catch(() => [] as Session[]);
    const ready = all.find(s => s.status === SessionStatus.READY);
    if (!ready) {
      this.logger.warn('No connected WhatsApp session; license delivery will retry on next poll');
      return false;
    }
    const text = [
      'terima kasih kak, pembayaran Watomatis sudah kami terima 🙏',
      '',
      'Ini kode lisensi kakak (simpan baik-baik):',
      '',
      rec.key,
      '',
      'Cara mengaktifkan:',
      '1. Install Watomatis, panduan lengkap: https://github.com/dermyhzo/openwa/blob/main/docs/watomatis/INSTALL.md',
      '2. Di akhir install, API key login dashboard muncul di layar. Buka http://localhost:2785 lalu login pakai key itu.',
      '3. Buka menu License, tempel kode lisensi di kolomnya, klik Aktifkan.',
      '',
      'Kalau ada kendala, balas chat ini saja ya kak, kami bantu sampai jalan.',
    ].join('\n');
    try {
      await this.messages.sendText(ready.id, { chatId: `${rec.phone}@c.us`, text });
      return true;
    } catch (err) {
      this.logger.warn(`License delivery to …${rec.phone.slice(-4)} failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async readLedger(): Promise<Record<string, IssuedRecord>> {
    try {
      return JSON.parse(await fs.readFile(this.ledgerPath, 'utf8')) as Record<string, IssuedRecord>;
    } catch {
      return {};
    }
  }

  private async writeLedger(ledger: Record<string, IssuedRecord>): Promise<void> {
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    await fs.writeFile(this.ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
  }
}
