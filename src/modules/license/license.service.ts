import { Injectable, BadRequestException } from '@nestjs/common';
import { LicenseStore } from './license-store.service';
import { DuitkuService } from './duitku.service';
import { PLANS } from './plans';

export interface LicenseStatus {
  active: boolean;
  tier: 'monthly' | 'sixmonth' | 'yearly' | 'lifetime' | null;
  lifetime: boolean;
  expiresAt: string | null;
}

@Injectable()
export class LicenseService {
  constructor(
    private readonly store: LicenseStore,
    private readonly duitku: DuitkuService,
  ) {}

  /** Returns true when a paid license is active (and not expired). */
  async isActive(): Promise<boolean> {
    return this.store.isActive();
  }

  async getStatus(): Promise<LicenseStatus> {
    const state = await this.store.get();
    const active = await this.store.isActive();
    const tier = (state.tier as LicenseStatus['tier']) ?? null;
    return {
      active,
      tier,
      lifetime: tier === 'lifetime' && state.expiresAt === null,
      expiresAt: state.expiresAt,
    };
  }

  async startPayment(plan: string, email: string): Promise<{ paymentUrl: string }> {
    const planConfig = PLANS[plan];
    if (!planConfig) {
      throw new BadRequestException(`Unknown plan: ${plan}. Available: ${Object.keys(PLANS).join(', ')}`);
    }

    const { paymentUrl, merchantOrderId } = await this.duitku.createInquiry({
      plan,
      price: planConfig.priceIDR,
      email,
    });

    await this.store.save({ tier: plan, lastOrderId: merchantOrderId });

    return { paymentUrl };
  }

  async handleCallback(body: Record<string, string>): Promise<void> {
    if (!this.duitku.verifyCallback(body)) {
      return;
    }

    if (body.resultCode !== '00') {
      return;
    }

    // Derive plan from the order id (format: wtm-{plan}-{timestamp})
    const state = await this.store.get();
    const orderId = body.merchantOrderId ?? state.lastOrderId ?? '';
    const planKey = orderId.replace(/^wtm-/, '').replace(/-\d+$/, '');
    const planConfig = PLANS[planKey];

    if (!planConfig) {
      return;
    }

    if (planConfig.durationDays === null) {
      // Lifetime: expiresAt stays null
      await this.store.save({ status: 'active', tier: planKey, expiresAt: null });
    } else {
      const expiresAt = new Date(Date.now() + planConfig.durationDays * 86400000).toISOString();
      await this.store.save({ status: 'active', tier: planKey, expiresAt });
    }
  }
}
