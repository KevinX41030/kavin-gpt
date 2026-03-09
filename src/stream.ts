export interface StreamEvent {
  event: string;
  data: string;
}

const parseJsonSafely = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const parseSseBlock = (block: string): StreamEvent | null => {
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];
  let event = 'message';

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message';
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  return {
    event,
    data: dataLines.join('\n').trim(),
  };
};

export const readSseResponse = async (
  response: Response,
  onEvent: (event: StreamEvent) => void | Promise<void>,
) => {
  if (!response.body) {
    throw new Error('服务端没有返回流式数据。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeBlock = async (block: string) => {
    const parsedBlock = parseSseBlock(block);

    if (parsedBlock) {
      await onEvent(parsedBlock);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      await consumeBlock(block);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    await consumeBlock(buffer);
  }
};

export const parseStreamData = <T>(value: string) => parseJsonSafely<T>(value);

export const readErrorResponse = async (response: Response) => {
  const text = (await response.text()).trim();

  if (!text) {
    return `请求失败（${response.status}）`;
  }

  const payload = parseJsonSafely<{ error?: string; message?: string }>(text);

  if (typeof payload?.error === 'string' && payload.error) {
    return payload.error;
  }

  if (typeof payload?.message === 'string' && payload.message) {
    return payload.message;
  }

  return text;
};
