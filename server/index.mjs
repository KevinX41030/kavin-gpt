import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 3001);

const app = express();

app.use(express.json({ limit: '2mb' }));

const splitModels = (value, fallback = []) => {
  const items = typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return items.length ? items : fallback;
};

const clampNumber = (value, min, max, fallback) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
};

const clampInteger = (value, min, max, fallback) =>
  Math.round(clampNumber(value, min, max, fallback));

const readProviders = () => {
  const providers = [
    {
      key: 'openai',
      label: 'OpenAI',
      type: 'openai-compatible',
      configured: Boolean(process.env.OPENAI_API_KEY),
      apiKey: process.env.OPENAI_API_KEY?.trim(),
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim(),
      models: splitModels(process.env.OPENAI_MODELS, [
        'gpt-4.1-mini',
        'gpt-4.1',
        'gpt-4o-mini',
      ]),
      description: 'OpenAI 官方接口，适合通用对话与工具场景。',
    },
    {
      key: 'anthropic',
      label: 'Anthropic',
      type: 'anthropic',
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
      models: splitModels(process.env.ANTHROPIC_MODELS, [
        'claude-sonnet-4-20250514',
        'claude-3-7-sonnet-20250219',
      ]),
      description: 'Claude 系列，适合长文本、写作和分析。',
    },
    {
      key: 'gemini',
      label: 'Gemini',
      type: 'gemini',
      configured: Boolean(process.env.GEMINI_API_KEY),
      apiKey: process.env.GEMINI_API_KEY?.trim(),
      baseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').trim(),
      models: splitModels(process.env.GEMINI_MODELS, ['gemini-2.5-flash', 'gemini-2.5-pro']),
      description: 'Google Gemini 标准接口，适合多模态与快速推理。',
    },
    {
      key: 'deepseek',
      label: 'DeepSeek',
      type: 'openai-compatible',
      configured: Boolean(process.env.DEEPSEEK_API_KEY),
      apiKey: process.env.DEEPSEEK_API_KEY?.trim(),
      baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').trim(),
      models: splitModels(process.env.DEEPSEEK_MODELS, [
        'deepseek-chat',
        'deepseek-reasoner',
      ]),
      description: 'DeepSeek OpenAI 兼容接口，中文与代码表现不错。',
    },
    {
      key: 'custom-openai',
      label: 'Custom OpenAI',
      type: 'openai-compatible',
      configured: Boolean(
        process.env.CUSTOM_OPENAI_API_KEY && process.env.CUSTOM_OPENAI_BASE_URL,
      ),
      apiKey: process.env.CUSTOM_OPENAI_API_KEY?.trim(),
      baseUrl: process.env.CUSTOM_OPENAI_BASE_URL?.trim(),
      models: splitModels(process.env.CUSTOM_OPENAI_MODELS),
      description: '自定义 OpenAI 兼容服务，适配私有网关或第三方平台。',
    },
  ];

  return providers;
};

const sanitizeMessages = (messages) => {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => {
      const role =
        message?.role === 'assistant' || message?.role === 'user'
          ? message.role
          : null;
      const content = typeof message?.content === 'string' ? message.content.trim() : '';

      if (!role || !content) {
        return null;
      }

      return { role, content };
    })
    .filter(Boolean);
};

const mergeAdjacentMessages = (messages, roleMapper = (role) => role) => {
  const merged = [];

  for (const message of messages) {
    const role = roleMapper(message.role);
    const previous = merged[merged.length - 1];

    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n\n${message.content}`;
      continue;
    }

    merged.push({ role, content: message.content });
  }

  return merged;
};

const parsePayload = (body) => {
  const provider = typeof body?.provider === 'string' ? body.provider.trim() : '';
  const model = typeof body?.model === 'string' ? body.model.trim() : '';
  const systemPrompt =
    typeof body?.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
  const messages = sanitizeMessages(body?.messages);
  const temperature = clampNumber(body?.temperature, 0, 2, 0.7);
  const maxTokens = clampInteger(body?.maxTokens, 128, 8192, 2048);

  if (!provider) {
    throw new Error('请选择模型服务。');
  }

  if (!model) {
    throw new Error('请输入模型名称。');
  }

  if (!messages.length) {
    throw new Error('至少要有一条消息。');
  }

  return {
    provider,
    model,
    systemPrompt,
    messages,
    temperature,
    maxTokens,
  };
};

const extractText = (value) => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part === 'object' && typeof part.text === 'string') {
        return part.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
};

const parseJsonResponse = async (response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const stripHtml = (value) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

const isHtmlDocument = (value) =>
  typeof value === 'string' && /<(?:!doctype|html|head|body)\b/i.test(value);

const normalizeErrorStatus = (statusCode) => {
  if (statusCode === 524) {
    return 504;
  }

  return statusCode >= 400 && statusCode < 600 ? statusCode : 502;
};

const normalizeRemoteError = (message, label, statusCode) => {
  if (!message) {
    return `${label} 请求失败（${statusCode}）。`;
  }

  if (!isHtmlDocument(message)) {
    return message;
  }

  const htmlText = stripHtml(message);
  const cloudflareCode = message.match(/Error code\s*(\d{3})/i)?.[1];
  const effectiveCode = cloudflareCode ? Number(cloudflareCode) : statusCode;

  if (effectiveCode === 524) {
    return `${label} 上游服务超时（Cloudflare 524）。这通常是长文本或长输出让模型网关处理过久导致的。建议降低 Max tokens、拆分长文本，或改用更稳定的直连服务。`;
  }

  const briefText = htmlText.replace(/\s+/g, ' ').trim();
  return `${label} 上游服务异常（${effectiveCode || statusCode}），返回了 HTML 错误页而不是模型结果。${briefText ? ` ${briefText.slice(0, 120)}${briefText.length > 120 ? '…' : ''}` : ''}`;
};

const extractOpenAICompatibleDelta = (choice) => {
  const deltaContent = choice?.delta?.content;

  if (typeof deltaContent === 'string') {
    return deltaContent;
  }

  if (Array.isArray(deltaContent)) {
    return extractText(deltaContent);
  }

  return extractText(choice?.message?.content);
};

const readOpenAICompatibleStream = async (response, label) => {
  if (!response.body) {
    throw createHttpError(`${label} 没有返回可读取的数据流。`, 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const consumeEventBlock = (block) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return;
    }

    const payloadText = dataLines.join('\n').trim();

    if (!payloadText || payloadText === '[DONE]') {
      return;
    }

    let payload;

    try {
      payload = JSON.parse(payloadText);
    } catch {
      return;
    }

    if (payload?.error) {
      throw createHttpError(readRemoteError(payload), 502);
    }

    const deltaText = extractOpenAICompatibleDelta(payload?.choices?.[0]);

    if (deltaText) {
      content += deltaText;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      consumeEventBlock(block);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    consumeEventBlock(buffer);
  }

  const finalContent = content.trim();

  if (!finalContent) {
    throw createHttpError(`${label} 没有返回文本内容。`, 502);
  }

  return finalContent;
};

const readRemoteError = (data) => {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data.raw === 'string') {
    return data.raw;
  }

  if (typeof data.error === 'string') {
    return data.error;
  }

  if (typeof data.error?.message === 'string') {
    return data.error.message;
  }

  if (typeof data.message === 'string') {
    return data.message;
  }

  return '';
};

const ensureSuccess = (response, data, label) => {
  if (response.ok) {
    return;
  }

  const detail = normalizeRemoteError(
    readRemoteError(data),
    label,
    response.status,
  );
  throw createHttpError(detail, normalizeErrorStatus(response.status));
};

const requestOpenAICompatible = async (providerConfig, payload) => {
  const endpoint = `${providerConfig.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${providerConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: payload.model,
      messages: payload.systemPrompt
        ? [{ role: 'system', content: payload.systemPrompt }, ...payload.messages]
        : payload.messages,
      temperature: payload.temperature,
      max_tokens: payload.maxTokens,
      stream: true,
    }),
  });

  const contentType = response.headers.get('content-type') || '';

  if (response.ok && contentType.includes('text/event-stream')) {
    return readOpenAICompatibleStream(response, providerConfig.label);
  }

  const data = await parseJsonResponse(response);
  ensureSuccess(response, data, providerConfig.label);

  const content = extractText(data?.choices?.[0]?.message?.content);

  if (!content) {
    throw new Error(`${providerConfig.label} 没有返回文本内容。`);
  }

  return content;
};

const requestAnthropic = async (providerConfig, payload) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': providerConfig.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: payload.model,
      system: payload.systemPrompt || undefined,
      messages: mergeAdjacentMessages(payload.messages).map((message) => ({
        role: message.role,
        content: [{ type: 'text', text: message.content }],
      })),
      temperature: payload.temperature,
      max_tokens: payload.maxTokens,
    }),
  });

  const data = await parseJsonResponse(response);
  ensureSuccess(response, data, providerConfig.label);

  const content = Array.isArray(data?.content)
    ? data.content
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n\n')
        .trim()
    : '';

  if (!content) {
    throw new Error(`${providerConfig.label} 没有返回文本内容。`);
  }

  return content;
};

const requestGemini = async (providerConfig, payload) => {
  const endpoint = `${providerConfig.baseUrl.replace(/\/$/, '')}/models/${payload.model}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': providerConfig.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: payload.systemPrompt
        ? {
            parts: [{ text: payload.systemPrompt }],
          }
        : undefined,
      contents: mergeAdjacentMessages(payload.messages, (role) =>
        role === 'assistant' ? 'model' : 'user',
      ).map((message) => ({
        role: message.role,
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: payload.temperature,
        maxOutputTokens: payload.maxTokens,
      },
    }),
  });

  const data = await parseJsonResponse(response);
  ensureSuccess(response, data, providerConfig.label);

  const content = Array.isArray(data?.candidates)
    ? data.candidates
        .map((candidate) =>
          Array.isArray(candidate?.content?.parts)
            ? candidate.content.parts
                .map((part) => (typeof part?.text === 'string' ? part.text : ''))
                .filter(Boolean)
                .join('\n')
            : '',
        )
        .find(Boolean)
        ?.trim() ?? ''
    : '';

  if (!content) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new Error(
      reason
        ? `${providerConfig.label} 没有返回文本内容（${reason}）。`
        : `${providerConfig.label} 没有返回文本内容。`,
    );
  }

  return content;
};

const routeChat = async (providerConfig, payload) => {
  if (!providerConfig.configured || !providerConfig.apiKey) {
    throw new Error(`${providerConfig.label} 尚未配置，请先填写对应 API Key。`);
  }

  if (providerConfig.type === 'openai-compatible') {
    return requestOpenAICompatible(providerConfig, payload);
  }

  if (providerConfig.type === 'anthropic') {
    return requestAnthropic(providerConfig, payload);
  }

  if (providerConfig.type === 'gemini') {
    return requestGemini(providerConfig, payload);
  }

  throw new Error(`暂不支持 ${providerConfig.label} 的请求方式。`);
};

app.get('/api/providers', (_request, response) => {
  response.json({
    providers: readProviders().map(({ apiKey, baseUrl, ...provider }) => provider),
  });
});

app.post('/api/chat', async (request, response) => {
  try {
    const payload = parsePayload(request.body);
    const providerConfig = readProviders().find(
      (provider) => provider.key === payload.provider,
    );

    if (!providerConfig) {
      throw new Error('未找到对应的模型服务。');
    }

    const content = await routeChat(providerConfig, payload);

    response.json({
      message: {
        id: crypto.randomUUID(),
        content,
      },
    });
  } catch (error) {
    response.status(error?.statusCode || 400).json({
      error: error instanceof Error ? error.message : '调用模型服务失败。',
    });
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));

  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/')) {
      next();
      return;
    }

    response.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Kavin GPT server listening on http://localhost:${port}`);
});
