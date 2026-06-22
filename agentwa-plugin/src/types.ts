/**
 * Local declarations of the OpenWA plugin contract AgentWA depends on.
 *
 * These are STRUCTURAL types (everything is duck-typed at runtime against the `ctx` object the
 * OpenWA worker hands the plugin). Declaring them locally keeps this plugin self-contained — it
 * imports nothing from OpenWA's source and needs no published SDK. Keep in sync with OpenWA's
 * `src/core/plugins` + `src/core/hooks` interfaces.
 */

export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface PluginMessagingCapability {
  sendText(sessionId: string, chatId: string, text: string): Promise<unknown>;
  reply(sessionId: string, chatId: string, quotedMessageId: string, text: string): Promise<unknown>;
}

export interface PluginEngineReadCapability {
  getGroupInfo(sessionId: string, groupId: string): Promise<unknown>;
  getContacts(sessionId: string): Promise<unknown>;
  getContactById(sessionId: string, contactId: string): Promise<unknown>;
  checkNumberExists(sessionId: string, phone: string): Promise<unknown>;
  getChats(sessionId: string): Promise<unknown>;
}

export interface PluginLogger {
  log(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void;
}

export type HookEvent = 'message:received' | 'message:sending' | 'message:sent' | 'message:failed' | string;

export interface HookContext<T = unknown> {
  event: HookEvent;
  data: T;
  sessionId?: string;
  timestamp: Date;
  source: string;
}

export interface HookResult<T = unknown> {
  continue: boolean;
  data?: T;
  error?: Error;
}

export type HookHandler<T = unknown> = (ctx: HookContext<T>) => Promise<HookResult<T>>;

export interface PluginContext {
  pluginId: string;
  config: Record<string, unknown>;
  logger: PluginLogger;
  storage: PluginStorage;
  messages: PluginMessagingCapability;
  engine: PluginEngineReadCapability;
  registerHook(event: HookEvent, handler: HookHandler, priority?: number): void;
}

export interface IPlugin {
  onLoad?(context: PluginContext): Promise<void> | void;
  onEnable?(context: PluginContext): Promise<void> | void;
  onDisable?(context: PluginContext): Promise<void> | void;
  onUnload?(context: PluginContext): Promise<void> | void;
  onConfigChange?(context: PluginContext, newConfig: Record<string, unknown>): Promise<void> | void;
  healthCheck?(): Promise<{ healthy: boolean; message?: string }>;
}

/** Minimal shape of the `message:received` payload AgentWA reads. */
export interface IncomingMessage {
  id: string;
  from: string;
  to: string;
  chatId: string;
  body: string;
  type: string;
  timestamp: number;
  fromMe: boolean;
  isGroup: boolean;
  isStatusBroadcast?: boolean;
  author?: string;
  mentionedIds?: string[];
  senderPhone?: string | null;
  contact?: { name?: string; pushName?: string };
  media?: { mimetype: string; filename?: string; data?: string };
  quotedMessage?: { id: string; body: string };
}
