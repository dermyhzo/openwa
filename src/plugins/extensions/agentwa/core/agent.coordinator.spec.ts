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
