import { Injectable, BadRequestException } from '@nestjs/common';
import { LicenseStore } from './license-store.service';
import { DuitkuService } from './duitku.service';
import { PLANS } from './plans';

@Injectable()
export class LicenseService {
  constructor(
    private readonly store: LicenseStore,
    private readonly duitku: DuitkuService,
  ) {}

  async getStatus() {
    const state = await this.store.get();
    const active = await this.store.isActive();
    return { ...state, active, plans: PLANS };
  }

  async startPayment(plan: string, email: string): Promise<{ paymentUrl: string }> {
    const planConfig = PLANS[plan];
    if (!planConfig) {
      throw new BadRequestException(`Unknown plan: ${plan}. Available: ${Object.keys(PLANS).join(', ')}`);
    }

    const { paymentUrl, merchantOrderId } = await this.duitku.createInquiry({
      plan,
      price: planConfig.price,
      email,
    });

    await this.store.save({ plan, lastOrderId: merchantOrderId });

    return { paymentUrl };
  }

  async handleCallback(body: Record<string, string>): Promise<void> {
    if (!this.duitku.verifyCallback(body)) {
      // Silently ignore invalid signatures (don't expose verification errors to caller)
      return;
    }

    if (body.resultCode !== '00') {
      return;
    }

    // Derive plan from the stored lastOrderId (format: wtm-{plan}-{timestamp})
    const state = await this.store.get();
    const orderId = body.merchantOrderId ?? state.lastOrderId ?? '';
    const planKey = orderId.replace(/^wtm-/, '').replace(/-\d+$/, '');
    const planConfig = PLANS[planKey];

    if (!planConfig) {
      return;
    }

    const validUntil = new Date(Date.now() + planConfig.durationDays * 86400000).toISOString();
    await this.store.save({ status: 'active', validUntil });
  }
}
