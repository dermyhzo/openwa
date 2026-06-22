# AgentWA MVP — Slice 1 (End-to-End LLM Auto-Reply) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working AgentWA built-in plugin that auto-replies to inbound WhatsApp DMs using an LLM (APImart, BYOT), grounded in a per-brand knowledge profile, with basic anti-spam guards — enable-able from the dashboard and testable on the laptop.

**Architecture:** One in-process built-in extension at `src/plugins/extensions/agentwa/`, hexagonal (framework-agnostic `core/` orchestrator + ports, with adapters over `ctx.messages`/`ctx.storage`). Mirrors the existing `translation` extension. The conversation pipeline is: guard → resolve brand → retrieve knowledge → call LLM → confidence gate → reply.

**Tech Stack:** TypeScript 5, NestJS 11, Jest + ts-jest (tests are colocated `*.spec.ts`), Node 22 global `fetch` for HTTP. No new dependencies.

**Conventions:**
- Run one test file: `npx jest <path>`. Run all: `npm test`. Typecheck/build: `npm run build`.
- All imports are **relative** (repo has no `src/*` path alias in jest).
- Every commit message ends with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Scope of Slice 1 (vertical slice that runs):** structural guards (skip group/fromMe/status) + per-chat cooldown; default + per-session brand profiles; APImart LLM; confidence gate (`canAnswer`); reply via `ctx.messages`. **Deferred to Slice 2:** multi-turn memory, daily cap & business hours, human-takeover pause, semantic Q&A cache, connectors/tool-calling, rich per-brand dashboard editor.

---

## Pre-flight (do once before Task 1)

- [ ] Create a working branch (do NOT commit on the upstream default branch):

```bash
cd /Users/dermysudarmono/openwa
git checkout -b feat/agentwa-mvp
```

- [ ] Create the plugin directory:

```bash
mkdir -p src/plugins/extensions/agentwa/{core,brand,llm,knowledge,guardrails,adapters}
```

---

## Task 1: Ports & domain types (contract)

Pure interfaces — no runtime behavior, so no unit test. Verified by `npm run build` and used by every later task.

**Files:**
- Create: `src/plugins/extensions/agentwa/core/ports.ts`

- [ ] **Step 1: Write the contract file**

```typescript
// Framework-agnostic contracts for the AgentWA core. NO NestJS/TypeORM/engine imports.

/** Normalized inbound message the coordinator works on (mapped from IncomingMessage). */
export interface IncomingTurn {
  sessionId: string;
  chatId: string;
  messageId: string;
  text: string;
  fromMe: boolean;
  isGroup: boolean;
  isStatusBroadcast: boolean;
  source: string; // 'Engine' for real inbound messages
}

/** Per-brand persona + knowledge (one brand == one WhatsApp session/number). */
export interface BrandProfile {
  name: string;
  systemPersona: string;
  businessProfile: string;
  faq: string;
  fallbackMessage: string;
}

/** Structured LLM output. `canAnswer=false` => not grounded => use fallback + handoff. */
export interface LlmResult {
  reply: string;
  canAnswer: boolean;
}

export interface BrandProfilePort {
  resolve(sessionId: string): BrandProfile;
}

export interface KnowledgePort {
  retrieve(profile: BrandProfile, query: string): string;
}

export interface LlmPort {
  complete(input: { systemPrompt: string; userText: string }): Promise<LlmResult>;
}

export interface GuardrailPort {
  /** True if the bot should auto-reply to this turn. */
  shouldHandle(turn: IncomingTurn): Promise<boolean>;
  /** Record that a reply was sent (for cooldown bookkeeping). */
  recordReply(chatId: string): Promise<void>;
}

export interface ChatGateway {
  sendText(sessionId: string, chatId: string, text: string): Promise<void>;
}

export interface Clock {
  now(): number; // epoch ms
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds (no errors from this file).

- [ ] **Step 3: Commit**

```bash
git add src/plugins/extensions/agentwa/core/ports.ts
git commit -m "feat(agentwa): add core ports and domain types"
```

---

## Task 2: Brand profile resolver

**Files:**
- Create: `src/plugins/extensions/agentwa/brand/brand-profile.resolver.ts`
- Test: `src/plugins/extensions/agentwa/brand/brand-profile.resolver.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { BrandProfileResolver } from './brand-profile.resolver';
import { BrandProfile } from '../core/ports';

const def: BrandProfile = {
  name: 'Default', systemPersona: 'p', businessProfile: 'b', faq: 'f', fallbackMessage: 'fb',
};
const brandA: BrandProfile = { ...def, name: 'Brand A' };

describe('BrandProfileResolver', () => {
  it('returns the per-session profile when present', () => {
    const r = new BrandProfileResolver(def, { 'sess-a': brandA });
    expect(r.resolve('sess-a').name).toBe('Brand A');
  });

  it('falls back to the default profile for unknown sessions', () => {
    const r = new BrandProfileResolver(def, {});
    expect(r.resolve('sess-x').name).toBe('Default');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/plugins/extensions/agentwa/brand/brand-profile.resolver.spec.ts`
Expected: FAIL — cannot find module './brand-profile.resolver'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { BrandProfile, BrandProfilePort } from '../core/ports';

/**
 * Resolves sessionId -> BrandProfile. One WhatsApp session/number == one brand.
 * MVP source is config: a per-session map with a default fallback. (Slice 2: storage override
 * + dashboard editor.)
 */
export class BrandProfileResolver implements BrandProfilePort {
  constructor(
    private readonly defaultProfile: BrandProfile,
    private readonly bySession: Record<string, BrandProfile>,
  ) {}

  resolve(sessionId: string): BrandProfile {
    return this.bySession[sessionId] ?? this.defaultProfile;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/plugins/extensions/agentwa/brand/brand-profile.resolver.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/extensions/agentwa/brand/
git commit -m "feat(agentwa): add brand profile resolver"
```

---

## Task 3: Knowledge port (profile-backed)

**Files:**
- Create: `src/plugins/extensions/agentwa/knowledge/profile-knowledge.ts`
- Test: `src/plugins/extensions/agentwa/knowledge/profile-knowledge.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ProfileKnowledge } from './profile-knowledge';
import { BrandProfile } from '../core/ports';

const profile: BrandProfile = {
  name: 'Toko', systemPersona: 'p', businessProfile: 'b',
  faq: 'Q: Jam buka? A: 08-21.', fallbackMessage: 'fb',
};

describe('ProfileKnowledge', () => {
  it('returns the brand FAQ as the retrieved knowledge', () => {
    const k = new ProfileKnowledge();
    expect(k.retrieve(profile, 'jam buka?')).toContain('08-21');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/plugins/extensions/agentwa/knowledge/profile-knowledge.spec.ts`
Expected: FAIL — cannot find module './profile-knowledge'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { BrandProfile, KnowledgePort } from '../core/ports';

/**
 * MVP knowledge: returns the brand's whole FAQ verbatim (no retrieval/embeddings yet).
 * The CachePort/semantic retrieval arrives in Slice 2 / Phase 2.
 */
export class ProfileKnowledge implements KnowledgePort {
  retrieve(profile: BrandProfile, _query: string): string {
    return profile.faq;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/plugins/extensions/agentwa/knowledge/profile-knowledge.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/extensions/agentwa/knowledge/
git commit -m "feat(agentwa): add profile-backed knowledge port"
```

---

## Task 4: System prompt builder

**Files:**
- Create: `src/plugins/extensions/agentwa/core/prompt.ts`
- Test: `src/plugins/extensions/agentwa/core/prompt.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { buildSystemPrompt } from './prompt';
import { BrandProfile } from './ports';

const profile: BrandProfile = {
  name: 'Toko Kopi', systemPersona: 'Ramah dan singkat.', businessProfile: 'Jual kopi.',
  faq: 'Q: Ongkir? A: Gratis di atas 100rb.', fallbackMessage: 'fb',
};

describe('buildSystemPrompt', () => {
  it('embeds persona, business profile, knowledge, and demands JSON output', () => {
    const p = buildSystemPrompt(profile, profile.faq, 'id');
    expect(p).toContain('Toko Kopi');
    expect(p).toContain('Jual kopi.');
    expect(p).toContain('Gratis di atas 100rb');
    expect(p).toContain('canAnswer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/plugins/extensions/agentwa/core/prompt.spec.ts`
Expected: FAIL — cannot find module './prompt'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { BrandProfile } from './ports';

/**
 * Builds the system prompt. Forces grounding (answer only from KNOWLEDGE) and a strict
 * JSON envelope so the caller can confidence-gate on `canAnswer`.
 */
export function buildSystemPrompt(profile: BrandProfile, knowledge: string, language: string): string {
  return [
    `Kamu adalah "${profile.name}", asisten customer service WhatsApp. ${profile.systemPersona}`,
    `Balas dalam bahasa "${language}" (default Bahasa Indonesia), singkat, sopan, dan ramah.`,
    `Jawab HANYA berdasarkan KNOWLEDGE di bawah. Jika jawabannya tidak ada di KNOWLEDGE,`,
    `set "canAnswer" ke false dan JANGAN mengarang harga, stok, atau janji apa pun.`,
    `Keluarkan HANYA objek JSON: {"reply": string, "canAnswer": boolean}.`,
    ``,
    `PROFIL BISNIS:`,
    profile.businessProfile,
    ``,
    `KNOWLEDGE:`,
    knowledge,
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/plugins/extensions/agentwa/core/prompt.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/extensions/agentwa/core/prompt.ts src/plugins/extensions/agentwa/core/prompt.spec.ts
git commit -m "feat(agentwa): add grounded system prompt builder"
```

---

## Task 5: Anti-ban guardrail (structural skips + per-chat cooldown)

**Files:**
- Create: `src/plugins/extensions/agentwa/guardrails/anti-ban.ts`
- Test: `src/plugins/extensions/agentwa/guardrails/anti-ban.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { AntiBanGuard } from './anti-ban';
import { IncomingTurn, Clock } from '../core/ports';
import { PluginStorage } from '../../../core/plugins';

function fakeStorage(): PluginStorage {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => (m.has(k) ? (m.get(k) as T) : null),
    set: async (k, v) => void m.set(k, v),
    delete: async k => void m.delete(k),
    list: async () => [...m.keys()],
  };
}
const turn = (over: Partial<IncomingTurn> = {}): IncomingTurn => ({
  sessionId: 's', chatId: 'c@c.us', messageId: 'm', text: 'hi',
  fromMe: false, isGroup: false, isStatusBroadcast: false, source: 'Engine', ...over,
});

describe('AntiBanGuard', () => {
  const clock: Clock = { now: () => 1_000_000 };

  it('skips group, fromMe, status, and non-engine turns', async () => {
    const g = new AntiBanGuard(fakeStorage(), clock, 30_000);
    expect(await g.shouldHandle(turn({ isGroup: true }))).toBe(false);
    expect(await g.shouldHandle(turn({ fromMe: true }))).toBe(false);
    expect(await g.shouldHandle(turn({ isStatusBroadcast: true }))).toBe(false);
    expect(await g.shouldHandle(turn({ source: 'Other' }))).toBe(false);
  });

  it('allows a normal DM, then blocks within the cooldown window', async () => {
    const storage = fakeStorage();
    const g = new AntiBanGuard(storage, clock, 30_000);
    expect(await g.shouldHandle(turn())).toBe(true);
    await g.recordReply('c@c.us');
    expect(await g.shouldHandle(turn())).toBe(false);
  });

  it('allows again after the cooldown elapses', async () => {
    const storage = fakeStorage();
    let t = 1_000_000;
    const movingClock: Clock = { now: () => t };
    const g = new AntiBanGuard(storage, movingClock, 30_000);
    await g.recordReply('c@c.us');
    t += 31_000;
    expect(await g.shouldHandle(turn())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/plugins/extensions/agentwa/guardrails/anti-ban.spec.ts`
Expected: FAIL — cannot find module './anti-ban'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Clock, GuardrailPort, IncomingTurn } from '../core/ports';
import { PluginStorage } from '../../../core/plugins';

/**
 * Slice-1 anti-ban: skip non-DM/own/status/non-engine messages, and enforce a per-chat cooldown
 * so the bot never machine-guns replies at one contact. (Daily cap + business hours: Slice 2.)
 */
export class AntiBanGuard implements GuardrailPort {
  constructor(
    private readonly storage: PluginStorage,
    private readonly clock: Clock,
    private readonly cooldownMs: number,
  ) {}

  private key(chatId: string): string {
    return `cooldown:${chatId}`;
  }

  async shouldHandle(turn: IncomingTurn): Promise<boolean> {
    if (turn.source !== 'Engine' || turn.fromMe || turn.isGroup || turn.isStatusBroadcast) {
      return false;
    }
    if (!turn.text.trim()) return false;
    const last = await this.storage.get<number>(this.key(turn.chatId));
    if (typeof last === 'number' && this.clock.now() - last < this.cooldownMs) {
      return false;
    }
    return true;
  }

  async recordReply(chatId: string): Promise<void> {
    await this.storage.set(this.key(chatId), this.clock.now());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/plugins/extensions/agentwa/guardrails/anti-ban.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/extensions/agentwa/guardrails/
git commit -m "feat(agentwa): add anti-ban guard with per-chat cooldown"
```

---

## Task 6: APImart LLM client (LlmPort)

**Files:**
- Create: `src/plugins/extensions/agentwa/llm/apimart.client.ts`
- Test: `src/plugins/extensions/agentwa/llm/apimart.client.spec.ts`

> APImart is OpenAI-compatible. Default base URL `https://api.apimart.ai/v1`, path `/chat/completions`. Both are configurable. Confirm specifics against the user's `apimart` skill if a call ever 404s.

- [ ] **Step 1: Write the failing test**

```typescript
import { ApimartClient } from './apimart.client';

describe('ApimartClient', () => {
  const cfg = { baseUrl: 'https://api.apimart.ai/v1', apiKey: 'k', model: 'gpt-4o-mini' };

  afterEach(() => {
    global.fetch = undefined as unknown as typeof fetch;
  });

  it('parses the structured JSON envelope from the model', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"reply":"Halo kak","canAnswer":true}' } }],
      }),
    }) as unknown as typeof fetch;

    const client = new ApimartClient(cfg);
    const r = await client.complete({ systemPrompt: 'sys', userText: 'hi' });
    expect(r).toEqual({ reply: 'Halo kak', canAnswer: true });
  });

  it('throws on a non-OK HTTP response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const client = new ApimartClient(cfg);
    await expect(client.complete({ systemPrompt: 's', userText: 'u' })).rejects.toThrow('500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/plugins/extensions/agentwa/llm/apimart.client.spec.ts`
Expected: FAIL — cannot find module './apimart.client'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { LlmPort, LlmResult } from '../core/ports';

export interface ApimartConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * LlmPort over APImart's OpenAI-compatible chat completions. Forces a JSON object response and
 * parses the {reply, canAnswer} envelope produced by buildSystemPrompt.
 */
export class ApimartClient implements LlmPort {
  constructor(private readonly cfg: ApimartConfig) {}

  async complete(input: { systemPrompt: string; userText: string }): Promise<LlmResult> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userText },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      throw new Error(`APImart HTTP ${res.status}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '{}';
    let parsed: { reply?: unknown; canAnswer?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      return { reply: '', canAnswer: false };
    }
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : '',
      canAnswer: parsed.canAnswer === true,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/plugins/extensions/agentwa/llm/apimart.client.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/extensions/agentwa/llm/
git commit -m "feat(agentwa): add APImart LLM client"
```

---

## Task 7: Chat gateway adapter (over ctx.messages)

**Files:**
- Create: `src/plugins/extensions/agentwa/adapters/plugin-chat.gateway.ts`
- Test: `src/plugins/extensions/agentwa/adapters/plugin-chat.gateway.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { PluginChatGateway } from './plugin-chat.gateway';
import { PluginMessagingCapability } from '../../../core/plugins';

describe('PluginChatGateway', () => {
  it('sends text through the plugin messaging capability', async () => {
    const sendText = jest.fn().mockResolvedValue({});
    const messages = { sendText, reply: jest.fn() } as unknown as PluginMessagingCapability;
    const gw = new PluginChatGateway(messages);
    await gw.sendText('s', 'c@c.us', 'halo');
    expect(sendText).toHaveBeenCalledWith('s', 'c@c.us', 'halo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/plugins/extensions/agentwa/adapters/plugin-chat.gateway.spec.ts`
Expected: FAIL — cannot find module './plugin-chat.gateway'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { ChatGateway } from '../core/ports';
import { PluginMessagingCapability } from '../../../core/plugins';

/** ChatGateway backed by ctx.messages (routes through MessageService → persistence preserved). */
export class PluginChatGateway implements ChatGateway {
  constructor(private readonly messages: PluginMessagingCapability) {}

  async sendText(sessionId: string, chatId: string, text: string): Promise<void> {
    await this.messages.sendText(sessionId, chatId, text);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/plugins/extensions/agentwa/adapters/plugin-chat.gateway.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/extensions/agentwa/adapters/
git commit -m "feat(agentwa): add chat gateway adapter"
```

---

## Task 8: Agent coordinator (orchestrator)

**Files:**
- Create: `src/plugins/extensions/agentwa/core/agent.coordinator.ts`
- Test: `src/plugins/extensions/agentwa/core/agent.coordinator.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { AgentCoordinator } from './agent.coordinator';
import { BrandProfile, ChatGateway, GuardrailPort, IncomingTurn, KnowledgePort, LlmPort, LlmResult } from './ports';

const profile: BrandProfile = {
  name: 'Toko', systemPersona: 'p', businessProfile: 'b', faq: 'f', fallbackMessage: 'Sebentar ya kak, CS kami bantu.',
};
const turn: IncomingTurn = {
  sessionId: 's', chatId: 'c@c.us', messageId: 'm', text: 'jam buka?',
  fromMe: false, isGroup: false, isStatusBroadcast: false, source: 'Engine',
};

function deps(over: {
  shouldHandle?: boolean;
  llm?: () => Promise<LlmResult>;
} = {}) {
  const sent: string[] = [];
  const recorded: string[] = [];
  const guard: GuardrailPort = {
    shouldHandle: async () => over.shouldHandle ?? true,
    recordReply: async c => void recorded.push(c),
  };
  const brand = { resolve: () => profile };
  const knowledge: KnowledgePort = { retrieve: () => 'k' };
  const llm: LlmPort = { complete: over.llm ?? (async () => ({ reply: 'Buka 08-21', canAnswer: true })) };
  const chat: ChatGateway = { sendText: async (_s, _c, t) => void sent.push(t) };
  return { coord: new AgentCoordinator(brand, guard, knowledge, llm, chat, 'id'), sent, recorded };
}

describe('AgentCoordinator', () => {
  it('replies with the LLM answer when grounded, and records the reply', async () => {
    const { coord, sent, recorded } = deps();
    await coord.handle(turn);
    expect(sent).toEqual(['Buka 08-21']);
    expect(recorded).toEqual(['c@c.us']);
  });

  it('does nothing when the guard rejects the turn', async () => {
    const { coord, sent } = deps({ shouldHandle: false });
    await coord.handle(turn);
    expect(sent).toEqual([]);
  });

  it('sends the fallback when the model is not confident (canAnswer=false)', async () => {
    const { coord, sent } = deps({ llm: async () => ({ reply: 'entah', canAnswer: false }) });
    await coord.handle(turn);
    expect(sent).toEqual(['Sebentar ya kak, CS kami bantu.']);
  });

  it('sends the fallback when the LLM call throws', async () => {
    const { coord, sent, recorded } = deps({ llm: async () => { throw new Error('boom'); } });
    await coord.handle(turn);
    expect(sent).toEqual(['Sebentar ya kak, CS kami bantu.']);
    expect(recorded).toEqual(['c@c.us']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/plugins/extensions/agentwa/core/agent.coordinator.spec.ts`
Expected: FAIL — cannot find module './agent.coordinator'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { BrandProfilePort, ChatGateway, GuardrailPort, IncomingTurn, KnowledgePort, LlmPort } from './ports';
import { buildSystemPrompt } from './prompt';

/**
 * Orchestrates one inbound turn: guard -> resolve brand -> retrieve knowledge -> LLM ->
 * confidence gate -> reply (or fallback) -> record. Never throws; on any error it falls back.
 */
export class AgentCoordinator {
  constructor(
    private readonly brand: BrandProfilePort,
    private readonly guard: GuardrailPort,
    private readonly knowledge: KnowledgePort,
    private readonly llm: LlmPort,
    private readonly chat: ChatGateway,
    private readonly language: string,
  ) {}

  async handle(turn: IncomingTurn): Promise<void> {
    if (!(await this.guard.shouldHandle(turn))) {
      return;
    }
    const profile = this.brand.resolve(turn.sessionId);
    const knowledge = this.knowledge.retrieve(profile, turn.text);
    const systemPrompt = buildSystemPrompt(profile, knowledge, this.language);

    let reply: string;
    try {
      const result = await this.llm.complete({ systemPrompt, userText: turn.text });
      reply = result.canAnswer && result.reply ? result.reply : profile.fallbackMessage;
    } catch {
      reply = profile.fallbackMessage;
    }

    await this.chat.sendText(turn.sessionId, turn.chatId, reply);
    await this.guard.recordReply(turn.chatId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/plugins/extensions/agentwa/core/agent.coordinator.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/extensions/agentwa/core/agent.coordinator.ts src/plugins/extensions/agentwa/core/agent.coordinator.spec.ts
git commit -m "feat(agentwa): add agent coordinator pipeline"
```

---

## Task 9: Plugin entry point + config wiring

**Files:**
- Create: `src/plugins/extensions/agentwa/index.ts`
- Test: `src/plugins/extensions/agentwa/index.spec.ts`

The pure, testable part is the `IncomingMessage -> IncomingTurn` mapper (`toTurn`). The rest is wiring exercised by the smoke test (Task 11).

- [ ] **Step 1: Write the failing test**

```typescript
import { toTurn } from './index';
import { HookContext } from '../../../core/hooks';
import { IncomingMessage } from '../../../engine/interfaces/whatsapp-engine.interface';

const ctx = (over: Partial<IncomingMessage> = {}, sessionId = 's'): HookContext<IncomingMessage> => ({
  event: 'message:received',
  sessionId,
  timestamp: new Date(0),
  source: 'Engine',
  data: {
    id: 'm', from: 'f', to: 't', chatId: 'c@c.us', body: 'hi', type: 'chat' as never,
    timestamp: 0, fromMe: false, isGroup: false, ...over,
  },
});

describe('toTurn', () => {
  it('maps an IncomingMessage hook context to an IncomingTurn', () => {
    const t = toTurn(ctx({ body: 'jam buka?' }));
    expect(t).toMatchObject({ sessionId: 's', chatId: 'c@c.us', text: 'jam buka?', source: 'Engine' });
  });

  it('defaults missing body and isStatusBroadcast safely', () => {
    const t = toTurn(ctx({ body: undefined as never }));
    expect(t.text).toBe('');
    expect(t.isStatusBroadcast).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/plugins/extensions/agentwa/index.spec.ts`
Expected: FAIL — cannot find module './index'.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { PluginContext, IPlugin } from '../../../core/plugins';
import { HookContext, HookResult } from '../../../core/hooks';
import { IncomingMessage } from '../../../engine/interfaces/whatsapp-engine.interface';
import { AgentCoordinator } from './core/agent.coordinator';
import { BrandProfile, Clock, IncomingTurn } from './core/ports';
import { BrandProfileResolver } from './brand/brand-profile.resolver';
import { ProfileKnowledge } from './knowledge/profile-knowledge';
import { AntiBanGuard } from './guardrails/anti-ban';
import { ApimartClient } from './llm/apimart.client';
import { PluginChatGateway } from './adapters/plugin-chat.gateway';

const systemClock: Clock = { now: () => Date.now() };

/** Pure mapper — unit tested. */
export function toTurn(ctx: HookContext<IncomingMessage>): IncomingTurn {
  const m = ctx.data;
  return {
    sessionId: ctx.sessionId ?? '',
    chatId: m.chatId,
    messageId: m.id,
    text: m.body ?? '',
    fromMe: m.fromMe,
    isGroup: m.isGroup,
    isStatusBroadcast: m.isStatusBroadcast ?? false,
    source: ctx.source,
  };
}

function str(cfg: Record<string, unknown>, key: string, fallback: string): string {
  const v = cfg[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function num(cfg: Record<string, unknown>, key: string, fallback: number): number {
  const v = cfg[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function profilesMap(cfg: Record<string, unknown>): Record<string, BrandProfile> {
  const v = cfg['brandProfiles'];
  return v && typeof v === 'object' ? (v as Record<string, BrandProfile>) : {};
}

export class AgentWaPlugin implements IPlugin {
  private coordinator: AgentCoordinator | null = null;

  onEnable(context: PluginContext): Promise<void> {
    this.coordinator = this.build(context);
    context.registerHook('message:received', ctx =>
      this.onMessage(context, ctx as HookContext<IncomingMessage>),
    );
    context.logger.log('AgentWA plugin enabled');
    return Promise.resolve();
  }

  onConfigChange(context: PluginContext): Promise<void> {
    this.coordinator = this.build(context);
    context.logger.log('AgentWA config updated');
    return Promise.resolve();
  }

  onDisable(context: PluginContext): Promise<void> {
    this.coordinator = null;
    context.logger.log('AgentWA plugin disabled');
    return Promise.resolve();
  }

  private build(context: PluginContext): AgentCoordinator {
    const cfg = context.config;
    const defaultProfile: BrandProfile = {
      name: str(cfg, 'defaultBrandName', 'Toko'),
      systemPersona: str(cfg, 'defaultSystemPersona', 'Ramah, singkat, membantu.'),
      businessProfile: str(cfg, 'defaultBusinessProfile', ''),
      faq: str(cfg, 'defaultFaq', ''),
      fallbackMessage: str(cfg, 'fallbackMessage', 'Mohon tunggu ya kak, CS kami akan segera membantu.'),
    };
    const brand = new BrandProfileResolver(defaultProfile, profilesMap(cfg));
    const knowledge = new ProfileKnowledge();
    const guard = new AntiBanGuard(
      context.storage,
      systemClock,
      num(cfg, 'perChatCooldownSec', 30) * 1000,
    );
    const llm = new ApimartClient({
      baseUrl: str(cfg, 'apiBaseUrl', 'https://api.apimart.ai/v1'),
      apiKey: str(cfg, 'apiKey', ''),
      model: str(cfg, 'model', 'gpt-4o-mini'),
    });
    const chat = new PluginChatGateway(context.messages);
    return new AgentCoordinator(brand, guard, knowledge, llm, chat, str(cfg, 'language', 'id'));
  }

  private async onMessage(
    context: PluginContext,
    ctx: HookContext<IncomingMessage>,
  ): Promise<HookResult> {
    if (!this.coordinator || !ctx.sessionId) {
      return { continue: true };
    }
    try {
      await this.coordinator.handle(toTurn(ctx));
    } catch (error) {
      context.logger.error('AgentWA handle failed', error);
    }
    return { continue: true }; // keep history/webhooks/ws intact
  }
}

export default AgentWaPlugin;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/plugins/extensions/agentwa/index.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/extensions/agentwa/index.ts src/plugins/extensions/agentwa/index.spec.ts
git commit -m "feat(agentwa): add plugin entry point and config wiring"
```

---

## Task 10: Register the built-in in ExtensionsRegistrar

**Files:**
- Modify: `src/plugins/extensions/extensions.module.ts`

- [ ] **Step 1: Add the import**

At the top of the file, next to the other plugin imports, add:

```typescript
import { AgentWaPlugin } from './agentwa';
```

- [ ] **Step 2: Register the plugin in `onModuleInit`**

After the existing `this.pluginLoader.registerBuiltInPlugin(translationManifest, new TranslationPlugin());` line, add:

```typescript
    const agentwaManifest: PluginManifest = {
      id: 'agentwa',
      name: 'AgentWA (AI Customer Service)',
      version: '0.1.0',
      type: PluginType.EXTENSION,
      description:
        'AI customer-service auto-reply (BYOT LLM via APImart), grounded in a per-brand knowledge profile. Disabled by default.',
      main: 'index.ts',
      permissions: ['messages:send'],
      sessions: ['*'],
      configSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string', title: 'LLM provider', enum: ['apimart'], default: 'apimart' },
          apiBaseUrl: { type: 'string', title: 'LLM base URL', default: 'https://api.apimart.ai/v1' },
          apiKey: { type: 'string', title: 'LLM API key', secret: true, required: true },
          model: { type: 'string', title: 'Model', default: 'gpt-4o-mini' },
          language: { type: 'string', title: 'Reply language', default: 'id' },
          perChatCooldownSec: { type: 'number', title: 'Per-chat cooldown (sec)', default: 30 },
          fallbackMessage: {
            type: 'string',
            title: 'Fallback message (when not confident)',
            default: 'Mohon tunggu ya kak, CS kami akan segera membantu.',
          },
          defaultBrandName: { type: 'string', title: 'Default brand name', default: 'Toko' },
          defaultSystemPersona: {
            type: 'string',
            title: 'Default persona',
            default: 'Ramah, singkat, membantu.',
          },
          defaultBusinessProfile: { type: 'string', title: 'Default business profile' },
          defaultFaq: { type: 'string', title: 'Default FAQ / knowledge' },
          brandProfiles: {
            type: 'object',
            title: 'Per-session brand profiles (advanced, JSON)',
            description:
              'Map sessionId -> { name, systemPersona, businessProfile, faq, fallbackMessage }. Leave empty to use the default profile for all sessions.',
          },
        },
      },
    };
    this.pluginLoader.registerBuiltInPlugin(agentwaManifest, new AgentWaPlugin());
    this.logger.log('AgentWA plugin registered (disabled)');
```

- [ ] **Step 3: Build to verify it compiles and the full test suite still passes**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass (including the new agentwa specs).

- [ ] **Step 4: Commit**

```bash
git add src/plugins/extensions/extensions.module.ts
git commit -m "feat(agentwa): register AgentWA built-in extension"
```

---

## Task 11: Build, run, and smoke-test on the laptop

No code — manual end-to-end verification on the running container.

- [ ] **Step 1: Rebuild and restart the container**

```bash
cd /Users/dermysudarmono/openwa
docker compose -f docker-compose.dev.yml up -d --build
```
Expected: `openwa-api` becomes healthy.

- [ ] **Step 2: Configure AgentWA (set API key + a brand profile)**

Replace `KEY` with your dashboard API key. Replace the LLM `apiKey` with a real APImart key.

```bash
KEY="<your-openwa-api-key>"
curl -s -X PUT http://localhost:2785/api/plugins/agentwa/config \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "apiKey": "<APIMART_KEY>",
    "model": "gpt-4o-mini",
    "defaultBrandName": "Toko Kopi",
    "defaultBusinessProfile": "Kami jual kopi bubuk dan biji.",
    "defaultFaq": "Q: Jam buka? A: 08.00-21.00 WIB. Q: Ongkir? A: Gratis untuk pembelian di atas Rp100.000."
  }'
```

- [ ] **Step 2b: Enable the plugin**

```bash
curl -s -X POST http://localhost:2785/api/plugins/agentwa/enable -H "X-API-Key: $KEY"
```
Expected: HTTP 200/201; container log shows `AgentWA plugin enabled`.

- [ ] **Step 3: Send a test message**

From a DIFFERENT WhatsApp number, send `jam buka kak?` to the connected number.
Expected: the bot replies (in Bahasa Indonesia) with the opening hours from the FAQ.

- [ ] **Step 4: Verify grounding / fallback**

Send an out-of-scope question, e.g. `kamu jual mobil?`.
Expected: the bot sends the fallback message (does NOT invent an answer).

- [ ] **Step 5: Verify guards**

- Send a 2nd message immediately → no reply (per-chat cooldown).
- Confirm group messages are not answered.

- [ ] **Step 6: Inspect logs if anything is off**

```bash
docker logs --tail 50 openwa-api 2>&1 | grep -i agentwa
```

---

## Spec Coverage (Slice 1)

| Spec requirement | Task |
|---|---|
| One built-in plugin `agentwa`, hexagonal | Tasks 1–10 |
| Hook `message:received` → coordinator | Tasks 8, 9 |
| Per-brand profile (multi-product via session) | Tasks 2, 9, 10 |
| Knowledge grounding | Tasks 3, 4 |
| LLM via APImart (BYOT, structured canAnswer) | Task 6 |
| Confidence gate + fallback | Task 8 |
| Anti-ban (structural skip + cooldown) | Task 5 |
| Reply via ctx.messages | Tasks 7, 8 |
| Config + dashboard form (secret apiKey) | Task 10 |
| Enable & test end-to-end | Task 11 |

**Deferred to Slice 2 (next plan):** multi-turn conversation memory; daily cap + business hours; human-takeover pause (`message:sent`); semantic Q&A cache (`CachePort`); connectors/tool-calling (`ToolPort`: shipping/Scalev); per-session brand editor UI; typing-delay; BYOT key encryption-at-rest.
