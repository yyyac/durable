export type ModelProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export interface ConfiguredModel { id: string; modelId: string; name: string; supportsThinking: boolean }
export interface ModelService {
  id: string;
  name: string;
  protocol: ModelProtocol;
  baseUrl: string;
  apiKeyMasked: string;
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

export type ContentBlock = { type: 'text'; text: string } | { type: 'thinking'; thinking: string };
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
export interface ConversationState {
  id: string;
  messages: ChatMessage[];
  generation: ChatMessage | null;
  busy: boolean;
  failure?: { reason: string; detail?: string };
}

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: number;
};
