// Bound both payload bytes and retained storage independently of network chunking.
export class ChatBodyError extends Error {
  constructor(public code: string, public status: number) { super(code); this.name = 'ChatBodyError'; }
}

type ChatBodyOptions = { maxBytes: number; signal?: AbortSignal; timeoutMs?: number };

export async function readChatBody(request: Request, options: ChatBodyOptions): Promise<Uint8Array<ArrayBuffer>> {
  const { maxBytes, signal, timeoutMs } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 ||
      (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0))) {
    throw new RangeError('Invalid body reader limits');
  }
  const reader = request.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectRead: ((error: ChatBodyError) => void) | undefined;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    rejectRead?.(new ChatBodyError('timeout', 504));
  };
  const signals = new Set([request.signal, signal].filter((value): value is AbortSignal => !!value));
  try {
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
      throw new ChatBodyError('request_too_large', 413);
    }
    for (const source of signals) {
      source.addEventListener('abort', stop, { once: true });
      if (source.aborted) stop();
    }
    if (interrupted) throw new ChatBodyError('timeout', 504);
    if (timeoutMs !== undefined) timer = setTimeout(stop, timeoutMs);
    if (!reader) return new Uint8Array();
    const blockSize = 64 * 1024;
    const blocks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      // A fresh interrupt promise avoids accumulating Promise.race reactions on
      // one pending abort promise for every tiny chunk.
      const interrupt = new Promise<never>((_, reject) => { rejectRead = reject; });
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await Promise.race([reader.read(), interrupt]); }
      finally { rejectRead = undefined; }
      if (interrupted) throw new ChatBodyError('timeout', 504);
      if (next.done) break;
      if (next.value.byteLength > maxBytes - size) throw new ChatBodyError('request_too_large', 413);
      // Copy immediately: never retain a network view or its possibly larger backing
      // buffer. The number of stored blocks is at most ceil(maxBytes / blockSize),
      // even for one-byte or empty input chunks.
      let offset = 0;
      while (offset < next.value.byteLength) {
        const blockIndex = Math.floor(size / blockSize);
        const blockOffset = size % blockSize;
        if (!blocks[blockIndex]) blocks.push(new Uint8Array(Math.min(blockSize, maxBytes - size)));
        const count = Math.min(next.value.byteLength - offset, blocks[blockIndex].length - blockOffset);
        blocks[blockIndex].set(next.value.subarray(offset, offset + count), blockOffset);
        offset += count; size += count;
      }
    }
    const bytes = new Uint8Array(size);
    for (let index = 0; index < blocks.length; index++) {
      bytes.set(blocks[index].subarray(0, Math.min(blocks[index].length, size - index * blockSize)), index * blockSize);
    }
    return bytes;
  } catch (error) {
    // Do not await untrusted stream cancellation: it may itself never settle.
    if (reader) void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    for (const source of signals) source.removeEventListener('abort', stop);
    reader?.releaseLock();
  }
}
