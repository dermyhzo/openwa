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
