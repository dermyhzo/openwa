import { Controller, Get, Post, Body, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LicenseService } from './license.service';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('license')
@Controller('license')
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  /**
   * GET /api/license/status
   * Returns: { active, tier, lifetime, expiresAt, issuedTo }
   */
  @Get('status')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get current license status' })
  @ApiResponse({ status: 200, description: '{ active, tier, lifetime, expiresAt, issuedTo }' })
  async getStatus() {
    return this.licenseService.getStatus();
  }

  // ponytail: kept the root GET for dashboard/legacy consumers
  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get current license status (alias)' })
  async getStatusAlias() {
    return this.licenseService.getStatus();
  }

  @Post('activate')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Activate this instance with a signed Watomatis license key' })
  @ApiResponse({ status: 201, description: 'License activated; returns the new status' })
  @ApiResponse({ status: 400, description: 'Invalid license key' })
  async activate(@Body() body: { key?: string }) {
    if (!body?.key?.trim()) throw new BadRequestException('key is required');
    return this.licenseService.activate(body.key);
  }
}
