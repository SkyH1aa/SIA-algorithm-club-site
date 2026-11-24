export const IMAGE_LIMITS = Object.freeze({references:4,referenceBytes:5*1024*1024,imageBytes:16*1024*1024,requestBytes:32*1024*1024,dimension:4096,pixels:16777216,prompt:12000,count:10});
export const IMAGE_RATIOS = Object.freeze(['auto','1:1','2:3','3:2','4:3','3:4','16:9','9:16','21:9','9:21']);

export function imageCapabilities(model) {
  const value = model?.image_config || {};
  return {...value,qualities:Array.isArray(value.qualities) ? value.qualities : ['auto'],sizes:Array.isArray(value.sizes) ? value.sizes : ['auto'],custom_size:value.custom_size === true,supports_references:value.supports_references === true,supports_transparency:value.supports_transparency === true,max_batch:Math.min(10,Math.max(1,Number(value.max_batch)||1)),max_dimension:Math.min(4096,Number(value.max_dimension)||4096),max_pixels:Math.min(16777216,Number(value.max_pixels)||16777216)};
}
export function dimensionsForRatio(edge, ratio = '1:1') {
  if (!Number.isInteger(edge) || edge < 256 || edge > 4096) throw new Error('size');
  const match = String(ratio).match(/^(\d+):(\d+)$/);
  const a = match ? Number(match[1]) : 1, b = match ? Number(match[2]) : 1;
  if (!a || !b) throw new Error('size');
  const align = value => Math.max(256, Math.round(value/16)*16);
  return {width:align(edge*a/Math.max(a,b)),height:align(edge*b/Math.max(a,b))};
}
export function validateImageOptions(options, config) {
  const cap = imageCapabilities({image_config:config});
  if (!cap.qualities.includes(options.quality)) throw new Error('quality');
  if (!['auto','opaque','transparent'].includes(options.background) || options.background === 'transparent' && !cap.supports_transparency) throw new Error('background');
  if (options.size !== 'auto') {
    const match = String(options.size).match(/^(\d+)x(\d+)$/);
    if (!match) throw new Error('size');
    const width = Number(match[1]), height = Number(match[2]);
    if (width < 256 || height < 256 || width > cap.max_dimension || height > cap.max_dimension || width%16 || height%16 || width*height > cap.max_pixels) throw new Error('size');
    if (!cap.custom_size && !cap.sizes.includes(options.size)) throw new Error('size');
  } else if (!cap.sizes.includes('auto')) throw new Error('size');
  return {...options};
}
export function imageQuotaRemaining(quota) {
  if (!quota) return 0;
  const numbers = [quota.global?.remaining,quota.user?.remaining].filter(value => value !== null && value !== undefined).map(Number);
  return numbers.length ? Math.max(0,Math.min(...numbers)) : Infinity;
}

export function inspectImage(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let width = 0, height = 0, mime = '';
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && String.fromCharCode(...bytes.slice(12,16)) === 'IHDR') {
    mime = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mime = 'image/jpeg';
    for (let offset = 2; offset+4 <= bytes.length;) {
      if (bytes[offset++] !== 255) break;
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset+2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset+size > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size >= 7) { height = view.getUint16(offset+3); width = view.getUint16(offset+5); break; }
      offset += size;
    }
  } else if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') {
    mime = 'image/webp';
    const type = String.fromCharCode(...bytes.slice(12,16));
    if (type === 'VP8X') { width = 1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16); height = 1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16); }
    else if (type === 'VP8L' && bytes[20] === 47) { width = 1+bytes[21]+((bytes[22]&63)<<8); height = 1+((bytes[22]&192)>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10); }
    else if (type === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = view.getUint16(26,true)&16383; height = view.getUint16(28,true)&16383; }
  }
  if (!width || !height || width > IMAGE_LIMITS.dimension || height > IMAGE_LIMITS.dimension || width*height > IMAGE_LIMITS.pixels) throw new Error('image_invalid');
  return {mime,width,height,ext:mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]};
}
export async function imageHash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function prepareImageReference(file) {
  if (!file?.size || file.size > IMAGE_LIMITS.referenceBytes) throw new Error('reference_size');
  const bytes = new Uint8Array(await file.arrayBuffer()), details = inspectImage(bytes);
  if (file.type && file.type !== details.mime) throw new Error('image_invalid');
  const blob = new Blob([bytes],{type:details.mime});
  if (typeof createImageBitmap === 'function') {
    let bitmap;
    try { bitmap = await createImageBitmap(blob); if (bitmap.width !== details.width || bitmap.height !== details.height) throw new Error('image_invalid'); }
    catch { throw new Error('image_invalid'); }
    finally { bitmap?.close(); }
  }
  return {name:String(file.name || `reference.${details.ext}`).slice(0,200),...details,bytes:bytes.byteLength,sha256:await imageHash(bytes),blob,archived:false};
}
export function imageBlobData(blob) {
  return new Promise((resolve,reject)=>{ const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('storage')); reader.readAsDataURL(blob); });
}
export async function generatedImage(value) {
  if (!value || typeof value.b64_json !== 'string' || value.b64_json.length > Math.ceil(IMAGE_LIMITS.imageBytes/3)*4+4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.b64_json)) throw new Error('image_invalid');
  let raw;
  try { raw = atob(value.b64_json); } catch { throw new Error('image_invalid'); }
  if (!raw.length || raw.length > IMAGE_LIMITS.imageBytes) throw new Error('image_invalid');
  const bytes = Uint8Array.from(raw,char=>char.charCodeAt(0)), details = inspectImage(bytes);
  if (value.mime && value.mime !== details.mime) throw new Error('image_invalid');
  const sha256 = await imageHash(bytes);
  if (value.sha256 && value.sha256 !== sha256) throw new Error('image_invalid');
  return {...details,sha256,bytes:bytes.byteLength,blob:new Blob([bytes],{type:details.mime}),archived:false};
}
export function imageArchiveSnapshot(record) {
  const reference = value => ({sha256:value.sha256,mime:value.mime,bytes:value.bytes,ext:value.ext,name:value.name,archived:Boolean(value.archived)});
  return {schema:'club-ai-image-archive/1',user_id:record.userId,record:{id:record.id,prompt:record.prompt,model_id:record.modelId,model_name:record.modelName,options:record.options,createdAt:record.createdAt,finishedAt:record.finishedAt || null,count:record.count,status:record.status,references:(record.references||[]).map(reference),images:(record.images||[]).map(value=>({...reference(value),slot:value.slot,width:value.width,height:value.height}))}};
}
