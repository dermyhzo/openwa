import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LicenseService } from './license.service';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('license')
@Controller('license')
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get current license status and available plans' })
  @ApiResponse({ status: 200, description: 'License state with active flag and plans' })
  async getStatus() {
    return this.licenseService.getStatus();
  }

  @Post('pay')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Start a Duitku payment for a plan' })
  @ApiResponse({ status: 201, description: 'Duitku payment URL to redirect the user to' })
  @ApiResponse({ status: 400, description: 'Unknown plan or Duitku error' })
  async pay(
    @Body() body: { plan: string; email?: string },
  ): Promise<{ paymentUrl: string }> {
    const email = body.email ?? 'operator@watomatis.local';
    return this.licenseService.startPayment(body.plan, email);
  }

  @Post('callback')
  @ApiOperation({ summary: 'Duitku server-to-server payment callback (no auth required)' })
  @ApiResponse({ status: 201, description: 'Callback processed' })
  async callback(
    @Body() body: Record<string, string>,
  ): Promise<{ ok: true }> {
    await this.licenseService.handleCallback(body);
    return { ok: true };
  }
}
