const MAX_BYTES = 100 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type, X-Test-Bytes, X-Test-Checksum'
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' }
  });
}

function checksumBytes(bytes: Uint8Array, current = 2166136261) {
  let value = current >>> 0;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value >>> 0;
}

function checksumText(value: number) {
  return value.toString(16).padStart(8, '0');
}

function parseSize(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('size') || String(MAX_BYTES);
  const size = Number(raw);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES) return null;
  return size;
}

function testChunk(start: number, length: number) {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = (start + index) & 0xff;
  }
  return bytes;
}

function generatedStream(size: number) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= size) {
        controller.close();
        return;
      }
      const length = Math.min(CHUNK_BYTES, size - offset);
      controller.enqueue(testChunk(offset, length));
      offset += length;
    }
  });
}

async function readRequestStream(request: Request) {
  if (!request.body) throw new Error('请求没有可读取的二进制 body。');

  const reader = request.body.getReader();
  let bytesRead = 0;
  let checksum = 2166136261;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_BYTES) {
      await reader.cancel('payload too large');
      throw new RangeError(`请求超过 ${MAX_BYTES} 字节。`);
    }
    checksum = checksumBytes(value, checksum);
  }

  return { bytesRead, checksum: checksumText(checksum) };
}

Deno.serve(async (request) => {
  const startedAt = performance.now();

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (request.method === 'POST') {
      const declaredLength = request.headers.get('content-length');
      if (declaredLength && Number(declaredLength) > MAX_BYTES) {
        return json({ error: '请求的 Content-Length 超过 100MiB。' }, 413);
      }

      const result = await readRequestStream(request);
      return json({
        ok: true,
        method: 'POST',
        bytes: result.bytesRead,
        checksum: result.checksum,
        elapsedMs: Math.round(performance.now() - startedAt),
        note: '服务端按 request.body 分块读取，未调用 request.arrayBuffer()。'
      });
    }

    if (request.method === 'GET') {
      const size = parseSize(request);
      if (size === null) return json({ error: 'size 必须是 0 到 100MiB 的整数。' }, 400);

      let checksum = 2166136261;
      for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
        checksum = checksumBytes(testChunk(offset, Math.min(CHUNK_BYTES, size - offset)), checksum);
      }

      return new Response(generatedStream(size), {
        headers: {
          ...corsHeaders,
          'content-type': 'application/octet-stream',
          'content-length': String(size),
          'content-disposition': `attachment; filename="stream-test-${size}.bin"`,
          'x-test-bytes': String(size),
          'x-test-checksum': checksumText(checksum)
        }
      });
    }

    return json({ error: '只支持 GET、POST 和 OPTIONS。' }, 405);
  } catch (error) {
    if (error instanceof RangeError) {
      return json({ error: error.message }, 413);
    }
    return json({ error: error instanceof Error ? error.message : '测试函数执行失败。' }, 500);
  }
});
