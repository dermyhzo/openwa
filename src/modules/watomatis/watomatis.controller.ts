import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiResponse } from '@nestjs/swagger';
import { WatomatisService, LearnResult } from './watomatis.service';
import { WatomatisStore } from './watomatis-store.service';
import type { WatomatisProfile } from './watomatis-store.service';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

const MAX_CSV_BYTES = 20 * 1024 * 1024; // 20 MB

function redactApiKey(profile: WatomatisProfile): WatomatisProfile {
  return { ...profile, apiKey: profile.apiKey ? '***' : '' };
}

@ApiTags('watomatis')
@Controller('watomatis')
export class WatomatisController {
  constructor(
    private readonly watomatisService: WatomatisService,
    private readonly store: WatomatisStore,
  ) {}

  @Post('learn')
  @RequireRole(ApiKeyRole.OPERATOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CSV_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Learn voice card and Q&A from a WAnalysis chat export CSV' })
  @ApiResponse({ status: 201, description: 'Extracted voice card and Q&A' })
  @ApiResponse({ status: 400, description: 'Missing file or apiKey' })
  async learn(
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @Body()
    body: {
      apiKey?: string;
      model?: string;
      apiBaseUrl?: string;
    },
  ): Promise<LearnResult> {
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    if (!body.apiKey) {
      throw new BadRequestException('apiKey is required');
    }

    const csv = file.buffer.toString('utf8');
    return this.watomatisService.learnFromCsv(csv, {
      apiKey: body.apiKey,
      model: body.model ?? 'gpt-4o-mini',
      baseUrl: body.apiBaseUrl ?? 'https://api.apimart.ai/v1',
    });
  }

  @Post('profile')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Save or update agent profile for a WhatsApp session' })
  @ApiResponse({ status: 201, description: 'Saved profile (apiKey redacted)' })
  @ApiResponse({ status: 400, description: 'Missing sessionId' })
  async saveProfile(@Body() body: WatomatisProfile): Promise<WatomatisProfile> {
    if (!body.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    const saved = await this.store.save(body);
    return redactApiKey(saved);
  }

  @Get('profile/:sessionId')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get agent profile for a WhatsApp session' })
  @ApiResponse({ status: 200, description: 'Profile (apiKey redacted) or null' })
  async getProfile(@Param('sessionId') id: string): Promise<WatomatisProfile | null> {
    const profile = await this.store.get(id);
    if (!profile) return null;
    return redactApiKey(profile);
  }

  @Get('profiles')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List all session ids that have a saved agent profile' })
  @ApiResponse({ status: 200, description: 'List of session ids' })
  async listProfiles(): Promise<{ sessionIds: string[] }> {
    return { sessionIds: await this.store.list() };
  }
}
