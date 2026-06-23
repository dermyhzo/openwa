/** Minimal LLM contract for the learning pipeline: a chat call that returns parsed JSON. */
export interface ChatLlm {
  json(systemPrompt: string, userText: string): Promise<Record<string, unknown>>;
}

export interface ApimartChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Tolerant JSON parse — accepts a raw object or one wrapped in prose / ```json fences. */
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
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        temperature: 0.2,
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return safeJson(data.choices?.[0]?.message?.content ?? '{}');
  }
}
