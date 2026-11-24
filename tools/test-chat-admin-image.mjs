import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

// Offline-only checks against the production configuration helpers.
const source = await readFile(new URL('../public/chat-admin.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/chat-admin.html', import.meta.url), 'utf8');
const nodes = new Map();
for (const id of [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1])) {
  assert(!nodes.has(id), `duplicate id ${id}`);
  nodes.set(id, {value: '', checked: false, type: ''});
}
for (const id of ['imageResponsesTool', 'imageCustomSize', 'imageReferences', 'imageTransparency']) nodes.get(id).type = 'checkbox';
const context = vm.createContext({$: id => nodes.get(id), asArray: value => Array.isArray(value) ? value : [], validInteger: (value, min, max) => Number.isInteger(value) && value >= min && value <= max});
const start = source.indexOf('const imageDefaults = '), end = source.indexOf('function clearModel()', start);
assert(start >= 0 && end > start);
vm.runInContext(source.slice(start, end), context);
const execute = code => vm.runInContext(code, context);
execute('fillImageConfig(null)');
const defaults = JSON.parse(JSON.stringify(execute('imageConfigInput()')));
assert.equal(defaults.api, 'images');
assert.deepEqual(defaults.sizes, ['auto', '1024x1024', '1024x1536', '1536x1024']);
assert.equal(defaults.max_pixels, 16777216);
assert.equal(defaults.max_batch, 10);
const backendUrl = new URL('../supabase/functions/_shared/chat-images.ts', import.meta.url).href;
const backendScript = `import {imageConfig} from ${JSON.stringify(backendUrl)}; let data=''; for await (const chunk of process.stdin) data += chunk; const inputs=JSON.parse(data); const results=inputs.map(input=>{try{return {ok:true,value:imageConfig(input)}}catch{return {ok:false}}}); console.log(JSON.stringify(results));`;
const backend = inputs => JSON.parse(execFileSync(process.execPath, ['--no-warnings', '--experimental-transform-types', '--input-type=module', '-e', backendScript], {input: JSON.stringify(inputs), encoding: 'utf8'}));
assert.deepEqual(backend([{}])[0].value, defaults, 'UI defaults match the actual backend defaults');
nodes.get('imageApi').value = 'custom';
nodes.get('imageRequestFormat').value = 'responses';
nodes.get('imageEndpoint').value = 'https://api.example.com/v1/response';
nodes.get('imageFieldMap').value = '{"prompt":"text"}';
const config = JSON.parse(JSON.stringify(execute('imageConfigInput()')));
assert.equal(config.endpoint, 'https://api.example.com/v1/response');
assert.deepEqual(config.field_map, {prompt: 'text'});
execute('previewImageEndpoint()');
assert.equal(nodes.get('imageEndpointPreview').textContent, config.endpoint);
assert.deepEqual(backend([config])[0], {ok: true, value: config}, 'Backend preserves singular full endpoint');
const endpointScript = `import {imageConfig,generateImage} from ${JSON.stringify(backendUrl)}; const seen=[]; globalThis.fetch=async url=>{seen.push(url);throw Error('offline stop')}; const input={prompt:'test',options:{size:'auto',quality:'auto',background:'auto'},references:[]}; for(const config of [imageConfig(${JSON.stringify(config)}),imageConfig({api:'responses',request_format:'responses'})]) { try { await generateImage({config,baseUrl:'https://api.example.com/v1/response',modelKey:'test',input,headers:new Headers(),signal:new AbortController().signal,validateUrl:async url=>url}); } catch(error) {if(error.message!=='offline stop') throw error;} } console.log(JSON.stringify(seen));`;
const endpoints = JSON.parse(execFileSync(process.execPath, ['--no-warnings', '--experimental-transform-types', '--input-type=module', '-e', endpointScript], {encoding: 'utf8'}));
assert.deepEqual(endpoints, [config.endpoint, config.endpoint], 'Custom endpoint and Responses base both retain the singular path');
const invalidConfigs = [
  {...defaults, max_batch: 0}, {...defaults, max_batch: 11}, {...defaults, max_dimension: 4097}, {...defaults, max_pixels: 16777217},
  {...defaults, qualities: ['auto', 'auto']}, {...defaults, sizes: ['bad size']}, {...defaults, media_hosts: ['Bad.example']},
  {...defaults, api: 'responses'}, {...defaults, api: 'custom', endpoint: ''}, {...defaults, endpoint: '/v1/response'},
  {...defaults, field_map: {prompt: 'text'}}, {...config, field_map: {unknown: 'text'}},
  {...config, field_map: {prompt: 'text', size: 'text'}}, {...config, fixed_parameters: {model: 'override'}}, {...config, fixed_parameters: {prompt: 'override'}}, {...config, fixed_parameters: {input: 'override'}},
  {...config, request_format: 'images', fixed_parameters: {text: 'conflict'}}, {...config, field_map: {size: 'quality'}}, {...config, result_path: 'a..b'}
];
const backendInvalid = backend(invalidConfigs);
invalidConfigs.forEach((candidate, index) => {
  context.candidate = candidate;
  execute('fillImageConfig(candidate)');
  assert.equal(backendInvalid[index].ok, false, `backend must reject invalid case ${index}`);
  assert.throws(() => execute('imageConfigInput()'), /image_config/, `UI must reject invalid case ${index}`);
});
execute('fillImageConfig(null)');
nodes.get('imageFieldMap').value = '[]';
assert.throws(() => execute('imageConfigInput()'), /image_config/);
nodes.get('imageFieldMap').value = '{}';
nodes.get('imageMaxBatch').value = '11';
assert.throws(() => execute('imageConfigInput()'), /image_config/);
assert.match(source, /item\.status === 'uncertain'/);
assert.match(source, /'image_admin_resolve', \{\.\.\.target, generated, note\}/);
assert.match(source, /'image_admin_save', \{settings\}/);
const options = {value: '', options: [], replaceChildren(...items) { this.options = items; this.value = items[0]?.value || ''; }, add(item) { this.options.push(item); }};
const mixed = vm.createContext({models: [
  {id: 'legacy', provider_id: 'provider', enabled: true, visibility: 'all', model_key: 'legacy'},
  {id: 'chat-assigned', provider_id: 'provider', enabled: true, purpose: 'chat', visibility: 'assigned', model_key: 'chat'},
  {id: 'image-public', provider_id: 'provider', enabled: true, purpose: 'image', visibility: 'all', model_key: 'image'},
  {id: 'image-assigned', provider_id: 'provider', enabled: true, purpose: 'image', visibility: 'assigned', model_key: 'private-image'}
], providers: [{id: 'provider', enabled: true}], $: () => options, t: key => key, first: (...values) => values.find(Boolean), modelKey: item => item.model_key, renderAccessUsers() {}, Option: function(text, value) { this.text = text; this.value = value; }});
vm.runInContext(source.slice(source.indexOf('function modelPurpose('), source.indexOf('let testBudgetModelId')), mixed);
vm.runInContext(source.slice(source.indexOf('function assistantEligibleModels()'), source.indexOf('function assistantControls()')), mixed);
vm.runInContext(source.slice(source.indexOf('function renderAccessModels()'), source.indexOf('function renderAccessUsers()')), mixed);
assert.deepEqual(Array.from(vm.runInContext('availableModels().map(item => item.id)', mixed)), ['legacy', 'chat-assigned']);
assert.deepEqual(Array.from(vm.runInContext('assistantEligibleModels().map(item => item.id)', mixed)), ['legacy']);
vm.runInContext('renderAccessModels()', mixed);
assert.deepEqual(options.options.map(option => option.value), ['', 'legacy', 'chat-assigned', 'image-public', 'image-assigned']);
assert(options.options.find(option => option.value === 'image-assigned').text.includes('purposeImage'));
console.log('PASS offline image admin defaults, backend validation parity, singular endpoint, mixed visibility, and action contracts');
