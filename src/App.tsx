import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createConversation,
  createId,
  formatClock,
  getProviderByKey,
  loadStoredConversations,
  normalizeConversations,
  now,
  saveStoredConversations,
  sortConversations,
  SUGGESTION_PROMPTS,
  truncateTitle,
} from './chat';
import type { ChatMessage, Conversation, ProviderInfo } from './types';

interface ProvidersResponse {
  providers: ProviderInfo[];
}

interface ChatResponse {
  message?: {
    id?: string;
    content?: string;
  };
  error?: string;
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败，请稍后再试。';

const App = () => {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [composer, setComposer] = useState('');
  const [isBooting, setIsBooting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [bootError, setBootError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const activeProvider = useMemo(
    () => getProviderByKey(providers, activeConversation?.provider ?? ''),
    [providers, activeConversation?.provider],
  );

  const configuredProviders = useMemo(
    () => providers.filter((provider) => provider.configured),
    [providers],
  );

  const canSend = Boolean(
    composer.trim() &&
      activeConversation?.provider &&
      activeConversation?.model &&
      activeProvider?.configured &&
      !isSending,
  );

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const response = await fetch('/api/providers');

        if (!response.ok) {
          throw new Error('无法连接后端服务，请确认服务端已经启动。');
        }

        const data = (await response.json()) as ProvidersResponse;
        const nextProviders = Array.isArray(data.providers) ? data.providers : [];
        const savedConversations = loadStoredConversations();
        const nextConversations = normalizeConversations(savedConversations, nextProviders);

        setProviders(nextProviders);
        setConversations(nextConversations);
        setActiveConversationId(nextConversations[0]?.id ?? '');
      } catch (error) {
        setBootError(getErrorMessage(error));
        const fallbackConversations = [createConversation([])];
        setProviders([]);
        setConversations(fallbackConversations);
        setActiveConversationId(fallbackConversations[0].id);
      } finally {
        setIsBooting(false);
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    if (isBooting) {
      return;
    }

    saveStoredConversations(conversations);
  }, [conversations, isBooting]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeConversation?.messages, isSending]);

  const patchConversation = (
    conversationId: string,
    updater: (conversation: Conversation) => Conversation,
  ) => {
    setConversations((current) =>
      sortConversations(
        current.map((conversation) =>
          conversation.id === conversationId ? updater(conversation) : conversation,
        ),
      ),
    );
  };

  const handleCreateConversation = () => {
    const draftConversation = createConversation(providers, {
      provider: activeConversation?.provider,
      model: activeConversation?.model,
      systemPrompt: activeConversation?.systemPrompt,
      temperature: activeConversation?.temperature,
      maxTokens: activeConversation?.maxTokens,
    });

    setConversations((current) => [draftConversation, ...current]);
    setActiveConversationId(draftConversation.id);
    setComposer('');
  };

  const handleDeleteConversation = (conversationId: string) => {
    const remaining = conversations.filter(
      (conversation) => conversation.id !== conversationId,
    );

    if (!remaining.length) {
      const draftConversation = createConversation(providers, {
        provider: activeConversation?.provider,
        model: activeConversation?.model,
        systemPrompt: activeConversation?.systemPrompt,
        temperature: activeConversation?.temperature,
        maxTokens: activeConversation?.maxTokens,
      });

      setConversations([draftConversation]);
      setActiveConversationId(draftConversation.id);
      return;
    }

    setConversations(sortConversations(remaining));

    if (activeConversationId === conversationId) {
      setActiveConversationId(remaining[0].id);
    }
  };

  const handleProviderChange = (providerKey: string) => {
    if (!activeConversation) {
      return;
    }

    const nextProvider = getProviderByKey(providers, providerKey);

    patchConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      provider: providerKey,
      model:
        conversation.model && conversation.provider === providerKey
          ? conversation.model
          : nextProvider?.models[0] ?? conversation.model,
      updatedAt: now(),
    }));
  };

  const handleConversationSetting = <K extends keyof Conversation>(
    key: K,
    value: Conversation[K],
  ) => {
    if (!activeConversation) {
      return;
    }

    patchConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      [key]: value,
      updatedAt: now(),
    }));
  };

  const handleSend = async (seed?: string) => {
    if (!activeConversation) {
      return;
    }

    const content = (seed ?? composer).trim();

    if (!content || !activeProvider?.configured || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content,
      createdAt: now(),
      provider: activeConversation.provider,
      model: activeConversation.model,
    };

    const requestConversation: Conversation = {
      ...activeConversation,
      title:
        activeConversation.messages.length === 0
          ? truncateTitle(content)
          : activeConversation.title,
      messages: [...activeConversation.messages, userMessage],
      updatedAt: now(),
    };

    patchConversation(activeConversation.id, () => requestConversation);
    setComposer('');
    setIsSending(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: requestConversation.provider,
          model: requestConversation.model,
          systemPrompt: requestConversation.systemPrompt,
          temperature: requestConversation.temperature,
          maxTokens: requestConversation.maxTokens,
          messages: requestConversation.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      const data = (await response.json().catch(() => null)) as ChatResponse | null;

      if (!response.ok) {
        throw new Error(data?.error ?? '模型服务调用失败。');
      }

      const assistantMessage: ChatMessage = {
        id: data?.message?.id ?? createId(),
        role: 'assistant',
        content: data?.message?.content?.trim() || '模型没有返回可显示的内容。',
        createdAt: now(),
        provider: requestConversation.provider,
        model: requestConversation.model,
      };

      patchConversation(requestConversation.id, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, assistantMessage],
        updatedAt: now(),
      }));
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: `请求失败：${getErrorMessage(error)}`,
        createdAt: now(),
        error: true,
        provider: requestConversation.provider,
        model: requestConversation.model,
      };

      patchConversation(requestConversation.id, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, assistantMessage],
        updatedAt: now(),
      }));
    } finally {
      setIsSending(false);
    }
  };

  if (isBooting || !activeConversation) {
    return (
      <div className="app-loading">
        <div className="loading-card">
          <span className="loading-dot" />
          <p>正在启动聊天工作台…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Multi Model Workspace</p>
            <h1>Kavin GPT</h1>
          </div>
          <button className="primary-button" onClick={handleCreateConversation}>
            + 新建对话
          </button>
        </div>

        <section className="sidebar-section">
          <div className="section-title-row">
            <h2>服务状态</h2>
            <span>{configuredProviders.length}/{providers.length || 0} 已连接</span>
          </div>
          <div className="status-grid">
            {providers.length ? (
              providers.map((provider) => (
                <div
                  className={`status-card ${
                    provider.configured ? 'status-card--on' : 'status-card--off'
                  }`}
                  key={provider.key}
                >
                  <strong>{provider.label}</strong>
                  <span>{provider.configured ? '已配置' : '未配置'}</span>
                </div>
              ))
            ) : (
              <div className="status-card status-card--off">
                <strong>后端未连接</strong>
                <span>请先启动服务</span>
              </div>
            )}
          </div>
        </section>

        <section className="sidebar-section sidebar-section--fill">
          <div className="section-title-row">
            <h2>对话历史</h2>
            <span>{conversations.length} 个会话</span>
          </div>
          <div className="chat-list">
            {conversations.map((conversation) => {
              const provider = getProviderByKey(providers, conversation.provider);

              return (
                <div
                  className={`chat-item ${
                    conversation.id === activeConversationId ? 'chat-item--active' : ''
                  }`}
                  key={conversation.id}
                >
                  <button
                    className="chat-item-main"
                    onClick={() => setActiveConversationId(conversation.id)}
                  >
                    <strong>{conversation.title}</strong>
                    <span>
                      {provider?.label ?? '未选择服务'}
                      {conversation.model ? ` · ${conversation.model}` : ''}
                    </span>
                    <time>{formatClock(conversation.updatedAt)}</time>
                  </button>
                  <button
                    aria-label="删除对话"
                    className="chat-delete-button"
                    onClick={() => handleDeleteConversation(conversation.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="sidebar-section sidebar-note">
          <p>支持 OpenAI、Anthropic、Gemini、DeepSeek 与自定义 OpenAI 兼容服务。</p>
        </section>
      </aside>

      <main className="main-panel">
        <header className="toolbar">
          <div>
            <p className="eyebrow">仿 OpenAI 风格聊天页</p>
            <h2>{activeConversation.title}</h2>
          </div>

          <div className="toolbar-actions">
            <label className="field-inline">
              <span>服务</span>
              <select
                onChange={(event) => handleProviderChange(event.target.value)}
                value={activeConversation.provider}
              >
                {!providers.length && <option value="">暂无服务</option>}
                {providers.map((provider) => (
                  <option key={provider.key} value={provider.key}>
                    {provider.label}
                    {provider.configured ? '' : '（未配置）'}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-inline field-inline--model">
              <span>模型</span>
              <input
                list="model-options"
                onChange={(event) => handleConversationSetting('model', event.target.value)}
                placeholder="输入或选择模型名"
                value={activeConversation.model}
              />
              <datalist id="model-options">
                {(activeProvider?.models ?? []).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>

            <button className="ghost-button" onClick={() => setShowSettings((value) => !value)}>
              {showSettings ? '收起设置' : '高级设置'}
            </button>
          </div>
        </header>

        {showSettings && (
          <section className="settings-panel">
            <label className="field">
              <div className="field-head">
                <span>系统提示词</span>
                <span>控制整体回答风格与身份</span>
              </div>
              <textarea
                onChange={(event) =>
                  handleConversationSetting('systemPrompt', event.target.value)
                }
                rows={4}
                value={activeConversation.systemPrompt}
              />
            </label>

            <div className="settings-grid">
              <label className="field">
                <div className="field-head">
                  <span>Temperature</span>
                  <strong>{activeConversation.temperature.toFixed(1)}</strong>
                </div>
                <input
                  max="2"
                  min="0"
                  onChange={(event) =>
                    handleConversationSetting(
                      'temperature',
                      Number(event.target.value),
                    )
                  }
                  step="0.1"
                  type="range"
                  value={activeConversation.temperature}
                />
              </label>

              <label className="field">
                <div className="field-head">
                  <span>Max tokens</span>
                  <span>控制最大输出长度</span>
                </div>
                <input
                  max="8192"
                  min="128"
                  onChange={(event) =>
                    handleConversationSetting('maxTokens', Number(event.target.value))
                  }
                  step="128"
                  type="number"
                  value={activeConversation.maxTokens}
                />
              </label>
            </div>

            {activeProvider?.description && (
              <p className="toolbar-hint">当前服务：{activeProvider.description}</p>
            )}
          </section>
        )}

        <section className="messages-scroller">
          <div className="messages-container">
            {bootError && <div className="alert-banner">{bootError}</div>}

            {!configuredProviders.length && (
              <div className="setup-card">
                <h3>先连接一个模型服务</h3>
                <p>
                  把 <code>.env.example</code> 复制为 <code>.env</code>，填入至少一个 API Key，
                  然后重启开发服务即可使用。
                </p>
              </div>
            )}

            {!activeConversation.messages.length && (
              <div className="hero-card">
                <p className="eyebrow">Ready to ship</p>
                <h3>一个像 OpenAI 的多模型对话入口</h3>
                <p>
                  左侧管理会话，顶部切换服务与模型，下方直接开始聊天。模型名支持手输，也支持从建议列表里选。
                </p>

                <div className="suggestion-grid">
                  {SUGGESTION_PROMPTS.map((prompt) => (
                    <button
                      className="suggestion-button"
                      key={prompt}
                      onClick={() => setComposer(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeConversation.messages.map((message) => {
              const provider = getProviderByKey(
                providers,
                message.provider ?? activeConversation.provider,
              );

              return (
                <article
                  className={`message-row message-row--${message.role}`}
                  key={message.id}
                >
                  <div
                    className={`message-card message-card--${message.role} ${
                      message.error ? 'message-card--error' : ''
                    }`}
                  >
                    <div className="message-meta">
                      <strong>{message.role === 'user' ? '你' : provider?.label ?? 'AI'}</strong>
                      <span>
                        {message.role === 'assistant'
                          ? message.model ?? activeConversation.model
                          : '发送中'}
                      </span>
                      <time>{formatClock(message.createdAt)}</time>
                    </div>
                    <div className="message-content">{message.content}</div>
                  </div>
                </article>
              );
            })}

            {isSending && (
              <article className="message-row message-row--assistant">
                <div className="message-card message-card--assistant">
                  <div className="message-meta">
                    <strong>{activeProvider?.label ?? 'AI'}</strong>
                    <span>{activeConversation.model || '未选择模型'}</span>
                  </div>
                  <div className="typing-indicator" aria-label="正在思考">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </article>
            )}
            <div ref={listEndRef} />
          </div>
        </section>

        <footer className="composer-shell">
          <form
            className="composer-card"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSend();
            }}
          >
            <textarea
              className="composer-textarea"
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (canSend) {
                    void handleSend();
                  }
                }
              }}
              placeholder={
                activeProvider?.configured
                  ? '给模型发条消息吧，Enter 发送，Shift + Enter 换行'
                  : '先配置服务，再开始对话'
              }
              rows={4}
              value={composer}
            />

            <div className="composer-footer">
              <p>
                {activeProvider?.configured
                  ? `${activeProvider.label} · ${activeConversation.model || '输入模型名'}`
                  : '当前服务未配置，发送按钮会自动禁用'}
              </p>

              <div className="composer-actions">
                <button className="ghost-button" onClick={() => setComposer('')} type="button">
                  清空
                </button>
                <button className="send-button" disabled={!canSend} type="submit">
                  {isSending ? '思考中…' : '发送'}
                </button>
              </div>
            </div>
          </form>
        </footer>
      </main>
    </div>
  );
};

export default App;

