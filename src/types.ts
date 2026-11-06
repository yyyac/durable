export type ModelProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export const DEFAULT_CONTEXT_WINDOW = 131072;
export const DEFAULT_MAX_TOKENS = 16384;
export interface ConfiguredModel { id: string; modelId: string; name: string; contextWindow: number; maxTokens: number; supportsThinking: boolean }
export interface ModelService {
  id: string;
  name: string;
  protocol: ModelProtocol;
  baseUrl: string;
  hasApiKey: boolean;
  models: ConfiguredModel[];
}
export interface ModelSelection { serviceId: string; modelId: string }
export interface ModelSettings {
  version: 2;
  services: ModelService[];
  selectedModel: ModelSelection | null;
}
export function selectedModel(settings: ModelSettings | null) {
  const service = settings?.services.find((item) => item.id === settings.selectedModel?.serviceId);
  const model = service?.models.find((item) => item.id === settings?.selectedModel?.modelId);
  return service && model ? { service, model } : null;
}

export type ThinkingTiming = { startedAt: number; endedAt?: number };
export type ToolCallState = { id: string; callId: string; name: string; arguments: Record<string, unknown>; status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'; output: string; cwd?: string };
export type ContentBlock = { type: 'text'; text: string } | { type: 'thinking'; thinking: string; timing?: ThinkingTiming } | { type: 'tool'; tool: ToolCallState };
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: number;
  stopReason?: string;
  errorMessage?: string;
  termination?: 'stopped' | 'interrupted';
}

export function canRetryReply(failure: ConversationState['failure']) {
  return Boolean(failure && ['model_error', 'no_model', 'faulted', 'orphaned', 'interrupted', 'restart_limit'].includes(failure.reason));
}
export type ContextUsage = { tokens: number; estimated: boolean; model?: { provider: string; modelId: string } };
export interface ConversationState {
  id: string;
  directory?: WorkingDirectory;
  messages: ChatMessage[];
  generation: ChatMessage | null;
  busy: boolean;
  contextUsage: ContextUsage;
  failure?: { reason: string; detail?: string };
}

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: number;
  archived?: boolean;
  defaultDirectory?: string;
  workspaceId?: string;
};

export type Workspace = { id: string; name: string; directory: string; createdAt: number };

export type WorkingDirectory = { path: string; available: boolean };
