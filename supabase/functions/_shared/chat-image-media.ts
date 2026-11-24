import { readChatBody } from './chat-body.ts';

export class ImageError extends Error {
  constructor(public code: string, public status = 400) { super(code); this.name = 'ImageError'; }
}
export const IMAGE_BYTES = 16 * 1024 * 1024;
export type ImageMedia = { bytes: Uint8Array<ArrayBuffer>; mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number; sha256: string };

export async function inspectImage(bytes: Uint8Array, maxBytes = IMAGE_BYTES, maxDimension = 4096, maxPixels = 16777216): Promise<ImageMedia> {
  if (!bytes.length || bytes.length > maxBytes) throw new ImageError('image_size', 413);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  let width = 0, height = 0, mime: ImageMedia['mime'];
  if (bytes.length >= 33 && ascii(0, 8) === '\x89PNG\r\n\x1a\n' && ascii(12, 4) === 'IHDR' && v.getUint32(8) === 13) {
    mime = 'image/png'; width = v.getUint32(16); height = v.getUint32(20);
  } else if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = 'image/jpeg'; let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p++] !== 0xff) break;
      while (p < bytes.length && bytes[p] === 0xff) p++;
      const marker = bytes[p++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (p + 2 > bytes.length) break;
      const len = v.getUint16(p);
      if (len < 2 || p + len > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        if (len < 8 || len !== 8 + 3 * bytes[p + 7]) break;
        height = v.getUint16(p + 3); width = v.getUint16(p + 5); break;
      }
      p += len;
    }
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && v.getUint32(4, true) + 8 === bytes.length) {
    mime = 'image/webp'; const kind = ascii(12, 4);
    const chunkSize = v.getUint32(16, true);
    if (20 + chunkSize + (chunkSize % 2) > bytes.length) throw new ImageError('image_format');
    if (kind === 'VP8X' && v.getUint32(16, true) >= 10) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === 'VP8 ' && chunkSize >= 10 && !(bytes[20] & 1) && bytes.length >= 30 && ascii(23, 3) === '\x9d\x01\x2a') {
      width = v.getUint16(26, true) & 0x3fff; height = v.getUint16(28, true) & 0x3fff;
    } else if (kind === 'VP8L' && chunkSize >= 5 && bytes.length >= 25 && bytes[20] === 0x2f && !(bytes[24] & 0xe0)) {
      const bits = v.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else throw new ImageError('image_format');
  if (!width || !height || width > maxDimension || height > maxDimension || width * height > maxPixels) throw new ImageError('image_dimensions');
  const owned = new Uint8Array(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned));
  const sha256 = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  return { bytes: owned, mime, width, height, sha256 };
}

export function decodeImageBase64(value: string, maxBytes: number): { bytes: Uint8Array; declaredMime?: string } {
  const match = /^(?:data:(image\/(?:png|jpeg|webp));base64,)?([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 || match[2].length > Math.ceil(maxBytes / 3) * 4) throw new ImageError('image_format');
  let binary: string;
  try { binary = atob(match[2]); } catch { throw new ImageError('image_format'); }
  if (!binary.length || binary.length > maxBytes) throw new ImageError('image_size', 413);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, declaredMime: match[1] };
}
export function encodeImageBase64(bytes: Uint8Array): string {
  let result = '';
  // Chunks are multiples of three so padding occurs only at the end.
  for (let i = 0; i < bytes.length; i += 49152) result += btoa(String.fromCharCode(...bytes.subarray(i, i + 49152)));
  return result;
}
export async function readImageResponse(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  return await readChatBody(new Request('https://bounded.invalid/', { method: 'POST', headers: response.headers, body: response.body, signal, duplex: 'half' } as RequestInit), { maxBytes, signal });
}
