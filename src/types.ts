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
  termination?: 'stopped' | 'interrupted';
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
  archived?: boolean;
};
