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
