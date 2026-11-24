// Offline: deno run tools/test-chat-images.ts, or node --experimental-transform-types tools/test-chat-images.ts
import { strict as assert } from 'node:assert';
import { imageCapabilities, imageConfig, imageInput, imageFingerprint, generateImage } from '../supabase/functions/_shared/chat-images.ts';
import { decodeImageBase64, inspectImage } from '../supabase/functions/_shared/chat-image-media.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b9sAAAAASUVORK5CYII=';
const data = `data:image/png;base64,${png}`;
const config = imageConfig({ supports_references:true });
const input = await imageInput({prompt:'draw', options:{size:'auto',quality:'auto',background:'auto'}, references:[{name:'x.png',data}]}, config);
assert.equal(input.references[0].media.width,1);
assert.equal(input.references[0].media.height,1);
assert.equal((await imageFingerprint('model',input)).length,64);
assert.notEqual(await imageFingerprint('model',input),await imageFingerprint('other',input));
assert.equal('media_hosts' in imageCapabilities(config), false);
assert.throws(() => imageConfig({max_pixels:16777217}));
assert.throws(() => imageConfig({unknown:true}));
assert.throws(() => imageConfig({api:'custom',request_format:'images',endpoint:'https://api.example/exact',field_map:{prompt:'model'}}));
assert.throws(() => imageConfig({api:'custom',request_format:'responses',endpoint:'https://api.example/exact',field_map:{model:'input'}}));
assert.throws(() => imageConfig({api:'custom',request_format:'chat',endpoint:'https://api.example/exact',fixed_parameters:{messages:'overwritten'}}));
assert.throws(() => imageConfig({api:'custom',request_format:'responses',endpoint:'https://api.example/exact',fixed_parameters:{n:2}}));
assert.throws(() => imageConfig({api:'custom',request_format:'images',endpoint:'https://api.example/exact',field_map:{n:'count'},fixed_parameters:{n:2}}));
assert.throws(() => decodeImageBase64('data:image/svg+xml;base64,AAAA',100));
await assert.rejects(() => inspectImage(new Uint8Array([1,2,3])));
await assert.rejects(() => imageInput({prompt:'x',options:{size:'auto',quality:'auto',background:'transparent'},references:[]},config));
await assert.rejects(() => imageInput({prompt:'x',options:{size:'auto',quality:'auto',background:'auto'},references:[{name:'../x',data}]},config));
const realFetch = globalThis.fetch;
try {
  let called = '';
  globalThis.fetch = async (url, init) => {
    called = String(url);
    assert.equal(init?.redirect,'error');
    return new Response(JSON.stringify({output:[{type:'image_generation_call',result:png}]}),{status:200});
  };
  const plain = await imageInput({prompt:'x',options:{size:'auto',quality:'auto',background:'auto'},references:[]},imageConfig({api:'responses',request_format:'responses'}));
  const result = await generateImage({config:imageConfig({api:'responses',request_format:'responses'}),baseUrl:'https://api.example/v1/response',modelKey:'demo',input:plain,headers:new Headers(),signal:new AbortController().signal,validateUrl:async x => x});
  assert.equal(called,'https://api.example/v1/response');
  assert.equal(result.mime,'image/png');
  for (const [base, expected] of [['https://api.example','https://api.example/images/generations'],['https://api.example/v1','https://api.example/v1/images/generations'],['https://api.example/v1/response','https://api.example/v1/images/generations']]) {
    globalThis.fetch = async url => { assert.equal(String(url),expected); return new Response(JSON.stringify({data:[{b64_json:png}]})); };
    await generateImage({config:imageConfig({}),baseUrl:base,modelKey:'demo',input:plain,headers:new Headers(),signal:new AbortController().signal,validateUrl:async x => x});
  }
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url),'https://api.example/v1/images/edits');
    assert(init?.body instanceof FormData);
    assert.equal((init.body as FormData).getAll('image[]').length,1);
    assert.equal((init.body as FormData).get('n'),'1');
    return new Response(JSON.stringify({data:[{b64_json:png}]}));
  };
  await generateImage({config,baseUrl:'https://api.example/v1',modelKey:'demo',input,headers:new Headers(),signal:new AbortController().signal,validateUrl:async x => x});
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url),'https://api.example/exact');
    const body = JSON.parse(String(init?.body)); assert.equal(body.description,'x'); assert.equal(body.safe,true);
    return new Response(JSON.stringify({result:{image:png}}));
  };
  await generateImage({config:imageConfig({api:'custom',request_format:'images',endpoint:'https://api.example/exact',field_map:{prompt:'description'},fixed_parameters:{safe:true},result_path:'result.image'}),baseUrl:'https://api.example/v1',modelKey:'demo',input:plain,headers:new Headers(),signal:new AbortController().signal,validateUrl:async x => x});
  globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:[{type:'image_url',image_url:{url:data}}]}}]}));
  await generateImage({config:imageConfig({api:'chat',request_format:'chat'}),baseUrl:'https://api.example/v1',modelKey:'demo',input:plain,headers:new Headers(),signal:new AbortController().signal,validateUrl:async x => x});
  let mediaFetched = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://8.8.8.8/')) { mediaFetched=true; assert.equal(String(url),'https://8.8.8.8/image.png?signature=1'); assert.equal(new Headers(init?.headers).has('authorization'),false); assert.equal(init?.redirect,'error'); return new Response(new Uint8Array(decodeImageBase64(png,10000).bytes)); }
    return new Response(JSON.stringify({data:[{url:'https://8.8.8.8/image.png?signature=1'}]}));
  };
  await generateImage({config:imageConfig({media_hosts:['8.8.8.8']}),baseUrl:'https://api.example/v1',modelKey:'demo',input:plain,headers:new Headers({authorization:'Bearer secret'}),signal:new AbortController().signal,validateUrl:async x => x});
  assert(mediaFetched);
  mediaFetched = false;
  globalThis.fetch = async url => {
    if (String(url).startsWith('https://cdn.example.com/')) { mediaFetched = true; throw new Error('hostname must not be fetched'); }
    return new Response(JSON.stringify({data:[{url:'https://cdn.example.com/image.png?signature=1'}]}));
  };
  await assert.rejects(() => generateImage({config:imageConfig({media_hosts:['cdn.example.com']}),baseUrl:'https://api.example/v1',modelKey:'demo',input:plain,headers:new Headers(),signal:new AbortController().signal,validateUrl:async x => x}), /image_media_url/);
  assert.equal(mediaFetched,false);
  globalThis.fetch = async () => new Response(JSON.stringify({data:[{url:'https://evil.example/image.png'}]}));
  await assert.rejects(() => generateImage({config:imageConfig({}),baseUrl:'https://api.example/v1',modelKey:'demo',input:plain,headers:new Headers(),signal:new AbortController().signal,validateUrl:async x => x}), /image_media_url/);
} finally { globalThis.fetch = realFetch; }
console.log('PASS image configuration, input, fingerprints, media and upstream adapters');
