export type MessageRole = 'user' | 'assistant';

export interface ChatImageAttachment {
  id: string;
  type: 'image';
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  error?: boolean;
  provider?: string;
  model?: string;
}

export interface ProviderInfo {
  key: string;
  label: string;
  type: string;
  configured: boolean;
  models: string[];
  description?: string;
}

export interface Conversation {
  id: string;
  title: string;
  provider: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
