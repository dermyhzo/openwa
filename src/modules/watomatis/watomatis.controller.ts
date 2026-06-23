import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiResponse } from '@nestjs/swagger';
import { WatomatisService, LearnResult } from './watomatis.service';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

const MAX_CSV_BYTES = 20 * 1024 * 1024; // 20 MB

@ApiTags('watomatis')
@Controller('watomatis')
export class WatomatisController {
  constructor(private readonly watomatisService: WatomatisService) {}

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
}
