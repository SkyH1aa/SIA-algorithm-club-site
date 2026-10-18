import assert from 'node:assert/strict';
import {normalizeChatResponse, readResponses, continuation, thinkingText, readableThinking, nativeRequest} from '../public/chat-core.js';

const message = text => ({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const reasoning = (texts, extra = {}) => ({type:'reasoning',summary:texts.map(text => ({type:'summary_text',text})),...extra});
const sse = (...events) => events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`).join('');
function stream(wire) {
  const bytes = new TextEncoder().encode(wire);
  return new ReadableStream({start(controller) {
    // Every byte is split, including UTF-8 and CRLF boundaries.
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  }});
}
const read = (events, protocol = 'responses', updates = []) => readResponses(stream(sse(...events)), value => updates.push(structuredClone(value)), protocol);
const summaryDelta = (output_index, summary_index, delta, item_id = `r${output_index}`) => ({type:'response.reasoning_summary_text.delta',output_index,summary_index,item_id,delta});
const textDelta = delta => ({type:'response.output_text.delta',delta});
const chatDelta = delta => ({choices:[{index:0,delta}]});
function isolated(result, answer, thinking) {
  assert.equal(result.text,answer);
  assert.equal(result.thinking,thinking);
  assert.equal(thinkingText(result.output),thinking,'saved output helper preserves readable thinking');
  assert.equal(readableThinking(result.output),thinking);
  const replay = continuation(result.output,false);
  assert.equal(replay.filter(item => item.type === 'message').flatMap(item => item.content).map(part => part.text).join(''),answer);
  assert.ok(replay.every(item => item.type === 'message'),'readable thinking is display-only');
  for (const protocol of ['messages','chat_completions']) {
    assert.doesNotThrow(() => nativeRequest({model:'test',input:replay,max_output_tokens:20},protocol));
  }
}

// Responses: interleaved multiple items/summary parts, repeated authoritative final stages.
{
  const updates = [];
  const final = [reasoning(['第一 part','second'],{id:'r0',encrypted_content:'opaque'}),message('answer'),reasoning(['third'],{id:'r2'})];
  const result = await read([
    {type:'response.output_item.added',output_index:0,item:reasoning([],{id:'r0'})},
    summaryDelta(2,0,'third'),summaryDelta(0,1,'second'),summaryDelta(0,0,'第一 '),summaryDelta(0,0,'part'),
    {type:'response.reasoning_summary_text.done',output_index:0,summary_index:0,item_id:'r0',text:'第一 part'},
    {type:'response.reasoning_summary_part.done',output_index:0,summary_index:1,part:{type:'summary_text',text:'second'}},
    {type:'response.output_item.done',output_index:0,item:final[0]},
    {type:'response.output_text.delta',output_index:1,content_index:0,item_id:'answer',delta:'ans'},
    {type:'response.completed',response:{status:'completed',output:final,usage:{output_tokens:7}}}
  ],'responses',updates);
  isolated(result,'answer','第一 part\n\nsecond\n\nthird');
  assert.equal(result.status,'success');
  assert.equal(result.usage.output_tokens,7);
  assert.equal(updates[1].thinking,'third');
  assert.equal(updates[2].thinking,'second\n\nthird');
  assert.equal(updates[3].thinking,'第一 \n\nsecond\n\nthird');
  assert.deepEqual(continuation(result.output,true)[0],{type:'reasoning',encrypted_content:'opaque',summary:[]});
  isolated(normalizeChatResponse({output:final,status:'completed'}),'answer',result.thinking);
}
{
  const updates = [];
  const result = await read([summaryDelta(0,0,'partial exposed'),{type:'response.completed',response:{output:[reasoning([],{id:'r0',encrypted_content:'secret'})]}}],'responses',updates);
  isolated(result,'','partial exposed');
  assert.equal(updates.at(-1).thinking,'partial exposed');
  const partial = await read([summaryDelta(0,0,'still thinking')]);
  isolated(partial,'','still thinking');
  assert.equal(partial.status,'interrupted');
  isolated(await read([summaryDelta(0,0,'visible'),{type:'error',error:{message:'failed'}}]),'','visible');
}
{
  const output = [reasoning(['exposed'],{encrypted_content:'DO_NOT_RENDER',signature:'DO_NOT_RENDER'}),
    {type:'reasoning',summary:[{type:'redacted_thinking',text:'DO_NOT_RENDER'}],encrypted_content:'DO_NOT_RENDER'},
    {type:'message',role:'assistant',content:[{type:'thinking',text:'DO_NOT_RENDER'},{type:'output_text',text:'body'}]}];
  isolated(normalizeChatResponse({output}),'body','exposed');
  assert.equal(thinkingText([{type:'reasoning',encrypted_content:'eyJ0ZXh0IjoiTk9QR SJ9',summary:[]}]),'');
  assert.equal(thinkingText(undefined),'');
}

// The server's normalized adapter reuses index 0 for reasoning and text, then shifts
// the final message to index 1. Both channels must be readable before the terminal.
{
  const updates = [];
  const events = [
    summaryDelta(0,0,'adapter summary'),
    {type:'response.output_text.delta',output_index:0,delta:'adapter '},
    {type:'response.output_text.delta',output_index:0,delta:'answer'},
    {type:'response.completed',response:{output:[reasoning(['adapter summary']),message('adapter answer')]}}
  ];
  const result = await read(events,'responses',updates);
  isolated(result,'adapter answer','adapter summary');
  isolated(updates[1],'adapter ','adapter summary');
  isolated(updates[2],'adapter answer','adapter summary');
  assert.equal(result.output.filter(item => item.type === 'message').length,1,'index shift cannot duplicate streamed answer');
  isolated(await read(events.slice(0,3)),'adapter answer','adapter summary');
}
{
  // Plain normalized adapter streams must still replay exactly one assistant turn.
  for (const indexed of [false,true]) {
    const delta = {type:'response.output_text.delta',delta:'plain answer',...(indexed ? {output_index:0} : {})};
    const result = await read([delta,{type:'response.completed',response:{output:[message('plain answer')]}}]);
    isolated(result,'plain answer','');
    assert.equal(result.output.filter(item => item.type === 'message').length,1);
    assert.equal(continuation(result.output,false).length,1);
  }
}
{
  const result = await read([
    {type:'response.reasoning_summary_text.delta',delta:'no index '},
    {type:'response.reasoning_summary_text.delta',delta:'summary'},
    {type:'response.output_text.delta',output_index:0,delta:'answer'},
    {type:'response.completed',response:{output:[reasoning(['no index summary']),message('answer')]}}
  ]);
  isolated(result,'answer','no index summary');
  const shifted = await read([
    summaryDelta(8,0,'first','first'),summaryDelta(9,0,'second','second'),
    {type:'response.completed',response:{output:[reasoning(['first'],{id:'first'}),message('answer'),reasoning(['second'],{id:'second'})]}}
  ]);
  isolated(shifted,'answer','first\n\nsecond');
}

// Chat Completions: both exposed string fields, alias precedence, final replacement.
for (const field of ['reasoning_content','reasoning']) {
  const updates = [];
  const result = await read([
    chatDelta({[field]:'思'}),chatDelta({[field]:'考',content:'ans'}),
    {choices:[{index:1,delta:{[field]:'wrong choice'}},{index:0,message:{content:'answer',[field]:'思考'},finish_reason:'stop'}]},
    {choices:[],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}},'[DONE]'
  ],'chat_completions',updates);
  isolated(result,'answer','思考');
  assert.equal(updates[0].thinking,'思');
  assert.equal(result.status,'success');
  assert.equal(result.usage.total_tokens,5);
  isolated(normalizeChatResponse({choices:[{index:0,message:{content:'answer',[field]:'思考'},finish_reason:'stop'}]},'chat_completions'),'answer','思考');
  const partial = await read([chatDelta({[field]:'partial'})],'chat_completions');
  isolated(partial,'','partial'); assert.equal(partial.status,'interrupted');
}
{
  const result = await read([chatDelta({reasoning_content:'one',reasoning:'one'}),{choices:[{index:0,delta:{},finish_reason:'stop'}]},'[DONE]'],'chat_completions');
  isolated(result,'','one');
  isolated(normalizeChatResponse({choices:[{message:{content:'body',reasoning:{encrypted_content:'hidden'},reasoning_content:null},finish_reason:'stop'}]},'chat_completions'),'body','');
}

// Claude: initial thinking, deltas, multiple block ordering, ignored signatures/redactions.
{
  const updates = [];
  const events = [
    {type:'message_start',message:{content:[{type:'thinking',thinking:'initial ',signature:'secret'}],usage:{input_tokens:2}}},
    {type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'continued'}},
    {type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'secret'}},
    {type:'content_block_start',index:3,content_block:{type:'thinking',thinking:'last'}},
    {type:'content_block_start',index:2,content_block:{type:'redacted_thinking',data:'secret'}},
    {type:'content_block_delta',index:2,delta:{type:'thinking_delta',thinking:'must remain hidden'}},
    {type:'content_block_start',index:1,content_block:{type:'thinking',thinking:'middle'}},
    {type:'content_block_start',index:4,content_block:{type:'text',text:'ans'}},
    {type:'content_block_delta',index:4,delta:{type:'text_delta',text:'wer'}},
    {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:4}}, {type:'message_stop'}
  ];
  const result = await read(events,'messages',updates);
  isolated(result,'answer','initial continued\n\nmiddle\n\nlast');
  assert.equal(updates[0].thinking,'initial ');
  assert.equal(result.status,'success');
  assert.ok(!JSON.stringify(result.output).includes('secret'));
  isolated(normalizeChatResponse({content:[{type:'thinking',thinking:'first',signature:'secret'},{type:'redacted_thinking',data:'secret'},{type:'thinking',thinking:'second'},{type:'text',text:'answer'}],stop_reason:'end_turn'},'messages'),'answer','first\n\nsecond');
  const partial = await read(events.slice(0,2),'messages');
  isolated(partial,'','initial continued'); assert.equal(partial.status,'interrupted');
}

// Explicit leading fallback: splits inside both delimiters, no terminal reintroduction.
for (const protocol of ['responses','chat_completions','messages']) {
  const chunks = ['<','th','ink>','private 思','考','</th','ink>','answer'];
  const events = chunks.map(delta => protocol === 'responses' ? textDelta(delta) : protocol === 'chat_completions' ? chatDelta({content:delta}) : {type:'content_block_delta',index:0,delta:{type:'text_delta',text:delta}});
  const terminal = protocol === 'responses' ? [{type:'response.completed',response:{output:[message(chunks.join(''))]}}] : protocol === 'chat_completions' ? [{choices:[{index:0,delta:{},finish_reason:'stop'}]},'[DONE]'] : [{type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'}];
  const updates = [];
  const result = await read([...events,...terminal],protocol,updates);
  isolated(result,'answer','private 思考');
  assert.equal(updates[0].text,''); assert.equal(updates[1].text,'');
  assert.equal(updates[3].thinking,'private 思'); assert.equal(updates[5].thinking,'private 思考');
  assert.ok(updates.every(value => !value.text.includes('private')));
  const json = protocol === 'responses' ? {output:[message('<think>private</think>answer')]} : protocol === 'messages' ? {content:[{type:'text',text:'<think>private</think>answer'}],stop_reason:'end_turn'} : {choices:[{message:{content:'<think>private</think>answer'},finish_reason:'stop'}]};
  isolated(normalizeChatResponse(json,protocol),'answer','private');
  isolated(await read([...events.slice(0,7)],protocol),'','private 思考');
}
{
  const taggedOnly = normalizeChatResponse({output:[message('<think>only thinking</think>')],output_text:'<think>only thinking</think>'});
  isolated(taggedOnly,'','only thinking');
  assert.deepEqual(continuation(taggedOnly.output,false),[],'thinking-only result must not replay an empty assistant message');
  isolated(await read([textDelta('<think>only thinking</think>'),{type:'response.completed',response:{output:[]}}]),'','only thinking');
  isolated(normalizeChatResponse({output:[message('<thi'),message('nk>private</thi'),message('nk>answer')]}),'answer','private');
  const old = [reasoning(['summary'],{encrypted_content:'opaque'}),message('<think>tagged</think>answer')];
  assert.equal(thinkingText(old),'summary\n\ntagged');
  assert.equal(continuation(old,false).map(item => item.content?.map(part => part.text).join('')).join(''),'answer');
}

// Literal preservation: fenced/inline/indented code, quotations, escapes, prose, nested/unmatched tags.
for (const literal of [
  '```xml\n<think>example</think>\n```', '`<think>example</think>`', '    <think>example</think>', '\t<think>example</think>',
  '"<think>example</think>"', "'<think>example</think>'", '> <think>example</think>', '\\<think>example</think>', '&lt;think&gt;example&lt;/think&gt;',
  'Explain <think>example</think> tags.', 'Let me think through this.', '<think>outer<think>inner</think></think>answer',
  '<think>unmatched', '<thi', '<think>example `</think>` tag</think>', '<think>quoted "</think>" text</think>', '<think>escaped \\</think> text</think>'
]) {
  isolated(normalizeChatResponse({output:[message(literal)]}),literal,'');
  const result = await read([...literal].map(textDelta));
  isolated(result,literal,'');
}

// Read error/cancellation retains the provider's last readable partial in onUpdate.
for (const protocol of ['responses','chat_completions','messages']) {
  const events = protocol === 'responses' ? [summaryDelta(0,0,'partial before abort')] : protocol === 'chat_completions' ? [chatDelta({reasoning_content:'partial before abort'})] : [{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'partial before abort'}}];
  const updates = []; let pulls = 0;
  const body = new ReadableStream({pull(controller) {
    if (!pulls++) controller.enqueue(new TextEncoder().encode(sse(...events)));
    else controller.error(new DOMException('aborted','AbortError'));
  }});
  await assert.rejects(readResponses(body,value => updates.push(value),protocol),{name:'AbortError'});
  isolated(updates.at(-1),'','partial before abort');
  assert.equal(updates.at(-1).status,'interrupted');
}
console.log('Chat thinking: Responses summaries, native Chat/Claude JSON/SSE, partial/cancel updates, conservative tag splits/literals and continuation isolation passed.');
