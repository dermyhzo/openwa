import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

@Injectable()
export class DuitkuService {
  private get merchantCode(): string {
    return process.env.DUITKU_MERCHANT_CODE ?? '';
  }

  private get merchantKey(): string {
    return process.env.DUITKU_MERCHANT_KEY ?? '';
  }

  private get baseUrl(): string {
    const env = process.env.DUITKU_ENV ?? 'sandbox';
    return env === 'production'
      ? 'https://passport.duitku.com'
      : 'https://sandbox.duitku.com';
  }

  private get publicBaseUrl(): string {
    return process.env.PUBLIC_BASE_URL ?? 'http://localhost:2785';
  }

  async createInquiry(params: {
    plan: string;
    price: number;
    email: string;
  }): Promise<{ paymentUrl: string; reference: string; merchantOrderId: string }> {
    const { plan, price, email } = params;
    const merchantOrderId = `wtm-${plan}-${Date.now()}`;
    const signature = md5(
      `${this.merchantCode}${merchantOrderId}${price}${this.merchantKey}`,
    );

    const body = {
      merchantCode: this.merchantCode,
      paymentAmount: price,
      merchantOrderId,
      productDetails: `Watomatis ${plan}`,
      email,
      callbackUrl: `${this.publicBaseUrl}/api/license/callback`,
      returnUrl: `${this.publicBaseUrl}/license`,
      signature,
      expiryPeriod: 60,
    };

    const res = await fetch(`${this.baseUrl}/webapi/api/merchant/v2/inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Duitku inquiry HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      statusCode: string;
      statusMessage: string;
      paymentUrl: string;
      reference: string;
    };

    if (data.statusCode !== '00') {
      throw new Error(`Duitku inquiry failed: ${data.statusMessage}`);
    }

    return { paymentUrl: data.paymentUrl, reference: data.reference, merchantOrderId };
  }

  verifyCallback(body: Record<string, string>): boolean {
    const { merchantCode, amount, merchantOrderId, signature } = body;
    if (!merchantCode || !amount || !merchantOrderId || !signature) return false;
    const expected = md5(`${this.merchantCode}${amount}${merchantOrderId}${this.merchantKey}`);
    return expected === signature;
  }
}
