import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiResponse } from '@nestjs/swagger';
import { WatomatisService, LearnResult } from './watomatis.service';
import { WatomatisStore } from './watomatis-store.service';
import type { WatomatisProfile } from './watomatis-store.service';
import { WatomatisDraftStore, WatomatisDraft } from './watomatis-drafts.service';
import { WatomatisRecordingStore, RecordedQna } from './watomatis-recording-store.service';
import { MessageService } from '../message/message.service';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { ApimartChat } from './learning/llm-chat';
import type { MinedQna } from './learning/types';
import { ShippingConnector } from './connectors/shipping.connector';
import { WatomatisSettingsStore } from './watomatis-settings-store.service';
import type { WatomatisSettings } from './watomatis-settings-store.service';
import { ForbiddenException } from '@nestjs/common';
import { LicenseService } from '../license/license.service';
import { WatomatisOrderStore, WatomatisOrder } from './watomatis-order-store.service';
import { ScalevConnector, ScalevStore } from './connectors/scalev.connector';
import { WatomatisRuntime } from './watomatis-runtime.service';

const MAX_CSV_BYTES = 20 * 1024 * 1024; // 20 MB
const READINESS_MIN_RECORDINGS = 20;

function redactApiKey(profile: WatomatisProfile): WatomatisProfile {
  return { ...profile, apiKey: profile.apiKey ? '***' : '' };
}

/** A recognisable but non-recoverable preview of a stored key (prefix + last 4), for the UI. */
function maskApiKey(key: string | undefined): string {
  if (!key) return '';
  return key.length <= 7 ? '••••' : `${key.slice(0, 3)}••••••${key.slice(-4)}`;
}

@ApiTags('watomatis')
@Controller('watomatis')
export class WatomatisController {
  constructor(
    private readonly watomatisService: WatomatisService,
    private readonly store: WatomatisStore,
    private readonly draftStore: WatomatisDraftStore,
    private readonly messages: MessageService,
    private readonly recordingStore: WatomatisRecordingStore,
    private readonly shippingConnector: ShippingConnector,
    private readonly settingsStore: WatomatisSettingsStore,
    private readonly orderStore: WatomatisOrderStore,
    private readonly scalev: ScalevConnector,
    private readonly license: LicenseService,
    private readonly runtime: WatomatisRuntime,
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

  @Post('learn-from-session/:sessionId')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Learn voice card and Q&A directly from a connected session\'s chat history (no file upload)' })
  @ApiResponse({ status: 201, description: 'Extracted voice card and Q&A from live message history' })
  @ApiResponse({ status: 400, description: 'Missing apiKey or session not active' })
  async learnFromSession(
    @Param('sessionId') sessionId: string,
    @Body()
    body: {
      apiKey?: string;
      model?: string;
      apiBaseUrl?: string;
      limit?: number;
    },
  ): Promise<LearnResult> {
    if (!body.apiKey) {
      throw new BadRequestException('apiKey is required');
    }

    return this.watomatisService.learnFromSession(
      sessionId,
      {
        apiKey: body.apiKey,
        model: body.model ?? 'gpt-4o-mini',
        baseUrl: body.apiBaseUrl ?? 'https://api.apimart.ai/v1',
      },
      body.limit ?? 500,
    );
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
    const existing = await this.store.get(body.sessionId);
    // Preserve the stored LLM key when the form sends it blank or redacted ("***"),
    // so editing a saved profile in the dashboard without re-typing the key does not wipe it.
    if (!body.apiKey || body.apiKey === '***') {
      if (existing?.apiKey) body.apiKey = existing.apiKey;
    }
    // Merge over any existing profile so a partial update (e.g. saving only the LLM
    // config) preserves the rest of the profile (voiceCard, qna, brandKnowledge,
    // products, guardrails, mode) instead of wiping fields that were not sent.
    const provided = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    ) as Partial<WatomatisProfile>;
    const merged = { ...(existing ?? {}), ...provided } as WatomatisProfile;
    const saved = await this.store.save(merged);
    return redactApiKey(saved);
  }

  @Get('profile/:sessionId')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get agent profile for a WhatsApp session' })
  @ApiResponse({ status: 200, description: 'Profile (apiKey redacted) or null' })
  async getProfile(
    @Param('sessionId') id: string,
  ): Promise<(WatomatisProfile & { apiKeyMask: string }) | null> {
    const profile = await this.store.get(id);
    if (!profile) return null;
    return { ...redactApiKey(profile), apiKeyMask: maskApiKey(profile.apiKey) };
  }

  @Get('profiles')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List all session ids that have a saved agent profile' })
  @ApiResponse({ status: 200, description: 'List of session ids' })
  async listProfiles(): Promise<{ sessionIds: string[] }> {
    return { sessionIds: await this.store.list() };
  }

  @Get('readiness/:sessionId')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Check agent readiness and suggest switching to full-auto mode' })
  @ApiResponse({ status: 200, description: 'Readiness report' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getReadiness(
    @Param('sessionId') sessionId: string,
  ): Promise<{ recordings: number; qna: number; ready: boolean; suggestFullAuto: boolean; reason: string }> {
    const profile = await this.store.get(sessionId);
    if (!profile) throw new NotFoundException(`No profile for session ${sessionId}`);

    const recordings = await this.recordingStore.count(sessionId);
    const qna = (profile.qna ?? []).length;
    const ready = recordings >= READINESS_MIN_RECORDINGS;
    const suggestFullAuto = profile.mode === 'supervised' && ready;
    const reason = ready
      ? `Agent sudah belajar dari ${recordings} percakapan — siap dicoba full-auto.`
      : `Masih belajar: ${recordings}/${READINESS_MIN_RECORDINGS} percakapan terekam.`;

    return { recordings, qna, ready, suggestFullAuto, reason };
  }

  @Get('drafts')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List pending drafts (optionally filtered by sessionId)' })
  @ApiResponse({ status: 200, description: 'List of drafts' })
  async listDrafts(@Query('sessionId') sessionId?: string): Promise<WatomatisDraft[]> {
    return this.draftStore.list(sessionId);
  }

  @Post('drafts/:id/approve')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Approve and send a draft reply (optionally override text)' })
  @ApiResponse({ status: 201, description: 'Draft sent and removed' })
  @ApiResponse({ status: 404, description: 'Draft not found' })
  async approveDraft(
    @Param('id') id: string,
    @Body() body: { text?: string },
  ): Promise<{ success: true }> {
    const draft = await this.draftStore.get(id);
    if (!draft) throw new NotFoundException(`Draft ${id} not found`);
    await this.messages.sendText(draft.sessionId, {
      chatId: draft.chatId,
      text: body?.text?.trim() || draft.reply,
    });
    await this.draftStore.remove(id);
    return { success: true };
  }

  @Delete('drafts/:id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Dismiss (delete) a draft without sending' })
  @ApiResponse({ status: 200, description: 'Draft removed' })
  async dismissDraft(@Param('id') id: string): Promise<{ success: true }> {
    await this.draftStore.remove(id);
    return { success: true };
  }

  @Get('recordings/:sessionId')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List recorded live Q&A pairs for a session' })
  @ApiResponse({ status: 200, description: 'Recorded Q&A count and items' })
  async listRecordings(
    @Param('sessionId') sessionId: string,
  ): Promise<{ count: number; items: RecordedQna[] }> {
    const items = await this.recordingStore.list(sessionId);
    return { count: items.length, items };
  }

  @Post('villages/search')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Search villages by name to get 10-digit village codes' })
  @ApiResponse({ status: 201, description: 'List of matching villages' })
  @ApiResponse({ status: 400, description: 'Missing apiKey or query' })
  async searchVillages(
    @Body() body: { apiKey?: string; query?: string },
  ): Promise<{ items: { code: string; name: string }[] }> {
    if (!body.apiKey) throw new BadRequestException('apiKey is required');
    if (!body.query) throw new BadRequestException('query is required');
    return { items: await this.shippingConnector.searchVillage(body.query, body.apiKey) };
  }

  @Post('recordings/:sessionId/consolidate')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Merge recorded Q&A into the agent knowledge base via LLM' })
  @ApiResponse({ status: 201, description: 'Updated Q&A list' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async consolidate(
    @Param('sessionId') sessionId: string,
  ): Promise<{ updated: number; qna: MinedQna[] }> {
    const profile = await this.store.get(sessionId);
    if (!profile) throw new NotFoundException(`No profile for session ${sessionId}`);

    const recordings = await this.recordingStore.list(sessionId);
    if (recordings.length === 0) {
      return { updated: 0, qna: profile.qna };
    }

    const llm = new ApimartChat({
      baseUrl: profile.apiBaseUrl || 'https://api.apimart.ai/v1',
      apiKey: profile.apiKey,
      model: profile.model || 'gpt-4o-mini',
    });

    const system = `You are a knowledge-base editor. Given EXISTING Q&A and NEW real customer Q&A pairs recorded from live chats, return a single cleaned, deduplicated Q&A list as JSON: {"qna":[{"question":"...","answer":"..."}]}. Rules: merge duplicates, prefer the more complete answer, drop pure chit-chat or greetings that carry no useful information. Return ONLY the JSON object, no prose.`;

    const existingJson = JSON.stringify(profile.qna ?? []);
    const newPairs = recordings.slice(0, 80);
    const newJson = JSON.stringify(newPairs.map(r => ({ question: r.question, answer: r.answer })));
    const userText = `EXISTING:\n${existingJson.slice(0, 4000)}\n\nNEW (from live chats):\n${newJson.slice(0, 4000)}`;

    const result = await llm.json(system, userText);

    const merged = result.qna;
    if (!Array.isArray(merged)) {
      throw new BadRequestException('LLM returned unexpected format — no qna array');
    }
    const validated = (merged as unknown[]).filter(
      (item): item is MinedQna =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).question === 'string' &&
        typeof (item as Record<string, unknown>).answer === 'string',
    );

    profile.qna = validated;
    await this.store.save(profile);
    return { updated: profile.qna.length, qna: profile.qna };
  }

  @Get('settings')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get global Watomatis settings (shipping config shared across all sessions)' })
  @ApiResponse({ status: 200, description: 'Global settings with plaintext apiKey' })
  async getSettings(): Promise<WatomatisSettings> {
    return this.settingsStore.get();
  }

  @Put('settings')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Save global Watomatis settings (shipping config shared across all sessions)' })
  @ApiResponse({ status: 200, description: 'Saved settings with plaintext apiKey' })
  async saveSettings(@Body() body: WatomatisSettings): Promise<WatomatisSettings> {
    return this.settingsStore.save(body);
  }

  @Get('orders')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List captured orders (optionally filtered by sessionId)' })
  async listOrders(@Query('sessionId') sessionId?: string): Promise<WatomatisOrder[]> {
    return this.orderStore.list(sessionId);
  }

  @Post('orders/:id/book')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Approve a captured order and create it in Scalev' })
  async bookOrder(@Param('id') id: string): Promise<{ success: true; scalevOrderId: string }> {
    if (!(await this.license.isActive())) throw new ForbiddenException('License not active');
    const order = await this.orderStore.get(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    const settings = await this.settingsStore.get();
    const result = await this.runtime.bookToScalev(settings, order);
    if ('error' in result) {
      await this.orderStore.update(id, { status: 'failed', lastError: result.error });
      throw new BadRequestException(result.error);
    }
    await this.orderStore.update(id, { status: 'booked', scalevOrderId: result.orderId });
    return { success: true, scalevOrderId: result.orderId };
  }

  @Delete('orders/:id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Delete a captured order' })
  async deleteOrder(@Param('id') id: string): Promise<{ success: true }> {
    await this.orderStore.remove(id);
    return { success: true };
  }

  @Get('scalev/stores')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List Scalev stores (with uuid + warehouses) for settings' })
  async scalevStores(): Promise<ScalevStore[]> {
    const settings = await this.settingsStore.get();
    if (!settings.scalev.apiKey) throw new BadRequestException('Scalev apiKey not configured');
    return this.scalev.listStores(settings.scalev.apiKey);
  }

  @Post('scalev/sync-catalog')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Pull Scalev products into the local catalog (refs P1..Pn)' })
  async syncCatalog(): Promise<{ count: number }> {
    if (!(await this.license.isActive())) throw new ForbiddenException('License not active');
    const settings = await this.settingsStore.get();
    if (!settings.scalev.apiKey) throw new BadRequestException('Scalev apiKey not configured');
    const items = await this.scalev.listProducts(settings.scalev.apiKey);
    settings.scalev.catalog = items.map((it, idx) => ({
      ref: `P${idx + 1}`,
      name: it.name,
      price: it.price,
      weightGram: it.weightGram,
      variantUniqueId: it.variantUniqueId,
    }));
    await this.settingsStore.save(settings);
    return { count: settings.scalev.catalog.length };
  }
}
