export interface ModelSettings {
  baseUrl: string;
  modelId: string;
  name: string;
  apiKeyMasked: string;
  supportsThinking?: boolean;
  protocol?: 'openai-completions' | 'anthropic-messages';
}

export type ContentBlock = { type: 'text'; text: string } | { type: 'thinking'; thinking: string };
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: number;
  stopReason?: string;
  errorMessage?: string;
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
