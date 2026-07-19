/** Minimal LLM contract for the learning pipeline: a chat call that returns parsed JSON. */
export interface ChatLlm {
  json(systemPrompt: string, userText: string): Promise<Record<string, unknown>>;
}

export interface ApimartChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Sampling temperature. Low (~0.2) for analysis/extraction, higher (~0.7) for natural replies. */
  temperature?: number;
}

/** Tolerant JSON parse: accepts a raw object or one wrapped in prose / ```json fences. */
export function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

/** ChatLlm over an OpenAI-compatible endpoint (APImart / OpenRouter). */
export class ApimartChat implements ChatLlm {
  constructor(private readonly cfg: ApimartChatConfig) {}

  async json(systemPrompt: string, userText: string): Promise<Record<string, unknown>> {
    const base = {
      model: this.cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      temperature: this.cfg.temperature ?? 0.2,
      stream: false,
    };
    const post = (body: object) =>
      fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
      });
    // Force a JSON object: on long/complex prompts the model otherwise ignores the "reply only JSON"
    // instruction and returns prose, which safeJson can't parse (the bot then sends its fallback).
    // If the model/prompt rejects response_format (BYOT model without support, or a prompt missing the
    // word "json"), retry once without it, degrading to the prompt-only behavior instead of erroring.
    let res = await post({ ...base, response_format: { type: 'json_object' } });
    if (res.status === 400) res = await post(base);
    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return safeJson(data.choices?.[0]?.message?.content ?? '{}');
  }
}
