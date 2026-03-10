import type {
  ChatAttachment,
  ChatMessage,
  Conversation,
  ProviderInfo,
} from './types';

export const STORAGE_KEY = 'kavin-gpt.conversations';

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer in Chinese unless the user asks for another language.';

export const SUGGESTION_PROMPTS = [
  '帮我写一个 SaaS 产品首页文案',
  '把这段需求整理成 PRD 大纲',
  '为一段 React 代码做 review 建议',
  '给我设计一个增长活动方案',
];

export const createId = () => crypto.randomUUID();

export const now = () => new Date().toISOString();

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const clampInteger = (value: number, min: number, max: number) =>
  Math.round(clamp(value, min, max));

export const truncateTitle = (value: string, maxLength = 26) => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return '新对话';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}…`
    : normalized;
};

export const formatClock = (value: string) =>
  new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

export const sortConversations = (items: Conversation[]) =>
  [...items].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

export const getProviderByKey = (
  providers: ProviderInfo[],
  key: string,
) => providers.find((provider) => provider.key === key);

const inferImageConversationTitle = (attachments: ChatAttachment[]) => {
  if (!attachments.length) {
    return '新对话';
  }

  return attachments.length === 1 ? '发送了 1 张图片' : `发送了 ${attachments.length} 张图片`;
};

const normalizeAttachment = (value: unknown): ChatAttachment | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const draft = value as Partial<ChatAttachment>;
  const type = draft.type === 'image' ? draft.type : null;
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  const mimeType = typeof draft.mimeType === 'string' ? draft.mimeType.trim() : '';
  const size = typeof draft.size === 'number' && Number.isFinite(draft.size) ? draft.size : 0;
  const dataUrl = typeof draft.dataUrl === 'string' && draft.dataUrl ? draft.dataUrl : undefined;

  if (!type || !mimeType) {
    return null;
  }

  return {
    id: typeof draft.id === 'string' && draft.id ? draft.id : createId(),
    type,
    name: name || 'image',
    mimeType,
    size,
    dataUrl,
  };
};

const getDefaultProvider = (providers: ProviderInfo[]) =>
  providers.find((provider) => provider.configured) ?? providers[0];

const normalizeMessage = (value: unknown): ChatMessage | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const draft = value as Partial<ChatMessage>;
  const role = draft.role === 'assistant' || draft.role === 'user' ? draft.role : null;
  const content = typeof draft.content === 'string' ? draft.content.trim() : '';
  const attachments = Array.isArray(draft.attachments)
    ? draft.attachments
        .map((attachment) => normalizeAttachment(attachment))
        .filter((attachment): attachment is ChatAttachment => Boolean(attachment))
    : [];

  if (!role || (!content && !attachments.length)) {
    return null;
  }

  return {
    id: typeof draft.id === 'string' && draft.id ? draft.id : createId(),
    role,
    content,
    attachments,
    createdAt:
      typeof draft.createdAt === 'string' && draft.createdAt ? draft.createdAt : now(),
    error: Boolean(draft.error),
    provider: typeof draft.provider === 'string' ? draft.provider : undefined,
    model: typeof draft.model === 'string' ? draft.model : undefined,
  };
};

export const createConversation = (
  providers: ProviderInfo[],
  overrides: Partial<Conversation> = {},
): Conversation => {
  const fallbackProvider =
    getProviderByKey(providers, overrides.provider ?? '') ?? getDefaultProvider(providers);
  const title = typeof overrides.title === 'string' ? overrides.title : '新对话';

  return {
    id: overrides.id ?? createId(),
    title: truncateTitle(title),
    provider: overrides.provider ?? fallbackProvider?.key ?? '',
    model: overrides.model ?? fallbackProvider?.models[0] ?? '',
    systemPrompt: overrides.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    temperature:
      typeof overrides.temperature === 'number'
        ? clamp(overrides.temperature, 0, 2)
        : 0.7,
    maxTokens:
      typeof overrides.maxTokens === 'number'
        ? clampInteger(overrides.maxTokens, 128, 8192)
        : 2048,
    messages: Array.isArray(overrides.messages) ? overrides.messages : [],
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  };
};

const normalizeConversation = (
  value: unknown,
  providers: ProviderInfo[],
): Conversation | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const draft = value as Partial<Conversation>;
  const messages = Array.isArray(draft.messages)
    ? draft.messages
        .map((message) => normalizeMessage(message))
        .filter((message): message is ChatMessage => Boolean(message))
    : [];
  const fallbackProvider =
    getProviderByKey(providers, typeof draft.provider === 'string' ? draft.provider : '') ??
    getDefaultProvider(providers);
  const inferredTitle =
    messages.find((message) => message.role === 'user')?.content ?? '新对话';
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const inferredAttachmentTitle = firstUserMessage?.attachments?.length
    ? inferImageConversationTitle(firstUserMessage.attachments)
    : '新对话';

  return createConversation(providers, {
    ...draft,
    id: typeof draft.id === 'string' && draft.id ? draft.id : createId(),
    title:
      typeof draft.title === 'string' && draft.title.trim()
        ? draft.title
        : truncateTitle(inferredTitle || inferredAttachmentTitle),
    provider: fallbackProvider?.key ?? '',
    model:
      typeof draft.model === 'string' && draft.model.trim()
        ? draft.model.trim()
        : fallbackProvider?.models[0] ?? '',
    systemPrompt:
      typeof draft.systemPrompt === 'string'
        ? draft.systemPrompt
        : DEFAULT_SYSTEM_PROMPT,
    temperature:
      typeof draft.temperature === 'number' ? draft.temperature : 0.7,
    maxTokens: typeof draft.maxTokens === 'number' ? draft.maxTokens : 2048,
    messages,
    createdAt:
      typeof draft.createdAt === 'string' && draft.createdAt ? draft.createdAt : now(),
    updatedAt:
      typeof draft.updatedAt === 'string' && draft.updatedAt ? draft.updatedAt : now(),
  });
};

export const normalizeConversations = (
  items: unknown[],
  providers: ProviderInfo[],
) => {
  const normalized = items
    .map((item) => normalizeConversation(item, providers))
    .filter((item): item is Conversation => Boolean(item));

  return normalized.length ? sortConversations(normalized) : [createConversation(providers)];
};

export const loadStoredConversations = () => {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return [] as unknown[];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [] as unknown[];
  }
};

export const saveStoredConversations = (items: Conversation[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    const sanitizedItems = items.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        content:
          message.content || (message.attachments?.length ? '🖼️ 已发送图片' : message.content),
        attachments: [],
      })),
    }));

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizedItems));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
};

export const deriveConversationTitle = (message: Pick<ChatMessage, 'content' | 'attachments'>) => {
  if (message.content.trim()) {
    return truncateTitle(message.content);
  }

  return inferImageConversationTitle(message.attachments ?? []);
};
