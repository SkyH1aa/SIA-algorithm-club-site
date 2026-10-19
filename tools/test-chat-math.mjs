// Real DOM, vendored marked + DOMPurify + KaTeX. No service/API access.
// npm install --prefix <temporary-directory> --ignore-scripts jsdom@26.1.0
// CHAT_MATH_JSDOM=<temporary-directory>/node_modules/jsdom node tools/test-chat-math.mjs
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
let JSDOM;
try { ({JSDOM} = require(process.env.CHAT_MATH_JSDOM || 'jsdom')); }
catch { throw new Error('Install jsdom@26.1.0 outside the repository and set CHAT_MATH_JSDOM to its node_modules/jsdom path.'); }
const root = fileURLToPath(new URL('../', import.meta.url));
const dom = new JSDOM('<!doctype html><body></body>', {runScripts:'outside-only',url:'https://local.example/chat.html'});
const window = dom.window;
const load = async name => window.eval(await readFile(path.join(root, 'public', name), 'utf8'));
for (const file of ['vendor/chat/marked.js','vendor/chat/purify.js','vendor/chat/katex/katex.min.js','chat-math.js']) await load(file);
assert.equal(window.katex.version, '0.19.0');
assert.equal(window.DOMPurify.isSupported, true);
const renderer = new window.marked.Renderer();
renderer.html = ({text}) => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
renderer.image = ({text}) => `[${text || 'image'}]`;
const options = {marked:window.marked,DOMPurify:window.DOMPurify,renderer};
const render = (text, extra = {}) => {
  const holder = window.document.createElement('div');
  holder.className = 'chat-markdown';
  const fragment = window.ChatMath.renderMarkdown(text, {...options,...extra});
  assert.equal(fragment.nodeType,11);
  holder.append(fragment);
  if (!text.includes('\uE000ChatMath')) assert.ok(!holder.textContent.includes('\uE000ChatMath'),'no placeholder leaks');
  return holder;
};
const count = node => node.querySelectorAll('.katex').length;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS',name); }

test('all explicit delimiters, conservative dollars, raw source untouched', () => {
  const text = String.raw`Inline \(x_i^2 + \alpha\) and $E=mc^2$.
\[\frac{1}{2} + \sqrt{x}\]

$$\begin{aligned}a&=b+c\\d&=e\end{aligned}$$`;
  const original = text;
  const node = render(text);
  assert.equal(count(node),4);
  assert.equal(node.querySelectorAll('.chat-math-display').length,2);
  assert.equal(node.querySelectorAll('math annotation[encoding="application/x-tex"]').length,4);
  assert.equal(text,original);
});
test('Markdown structure, code content, raw HTML escaping and decorator compatibility', () => {
  let decorated = 0;
  const text = String.raw`# Math \(x^2\)

- **bold** $x_i$
- [safe](https://example.com)

| Value | Formula |
| --- | --- |
| yes | $x^2$ |

> quote \(y\)

\`\`\`js
const raw = "\\(x\\) $$y$$ $z$";
\`\`\`

Inline \`$x$\` and <b>raw</b>.`.replaceAll('\\`','`');
  const node = render(text,{decorateCode:fragment => {decorated++; assert.equal(fragment.querySelectorAll('pre code').length,1);}});
  assert.equal(count(node),4);
  assert.equal(node.querySelector('h1').textContent.includes('Math'),true);
  assert.equal(node.querySelector('strong').textContent,'bold');
  assert.equal(node.querySelector('code').textContent,'const raw = "\\\\(x\\\\) $$y$$ $z$";\n');
  assert.equal(node.querySelectorAll('code')[1].textContent,'$x$');
  assert.equal(node.querySelector('b'),null);
  assert.ok(node.textContent.includes('<b>raw</b>'));
  assert.equal(decorated,1);
});
test('fenced, nested, indented, variable backtick spans and unfinished fences', () => {
  for (const text of [
    '```tex\n\\(x\\) $$y$$ $z$\n```', '~~~\n\\[x\\] $y$\n~~~',
    '> ```tex\n> \\(x\\)\n> ```', '- item\n\n  ```\n  $x$\n  ```',
    '    \\(x\\) $$y$$', '\t$x$', '``a `$x$` b``', '```\n$x$', '`\\(x\\)`'
  ]) assert.equal(count(render(text)),0,text);
});
test('stray math openers do not swallow subsequent Markdown code', () => {
  for (const text of ['$$\n```tex\n$x$\n```\n$$', String.raw`\[` + '\n~~~tex\n$x$\n~~~', String.raw`\(x + \`$y$\`\)`.replaceAll('\\`','`')]) {
    const node = render(text);
    assert.equal(count(node),0,text);
    assert.ok(node.querySelector('code'),text);
    assert.ok(node.querySelector('code').textContent.includes('$'),text);
  }
});
test('money, escapes, literal dollar adjacency, unmatched delimiters', () => {
  for (const text of [String.raw`Costs $5 and $10; US$20; $ 30; $10.50`, String.raw`\$x$ and \\(x\\)`, '$123$', '$ x $', 'word$x$word', '$x\ny$', '$x', '$$', '\\(', '\\[', String.raw`\(x_1`, String.raw`\[\frac{1}{`, '$$x_1']) {
    const node = render(text);
    assert.equal(count(node),0,text);
    if (text.startsWith('\\(') || text.startsWith('\\[') || text.startsWith('$$')) assert.ok(node.textContent.includes(text),text);
  }
});
test('every explicit streaming prefix remains literal until closed', () => {
  for (const source of [String.raw`\(x_i + \alpha\)`,String.raw`\[\frac{a}{b}\]`,'$$x_i^2$$']) {
    for (let end = 1; end < source.length; end++) {
      const partial = source.slice(0,end), node = render(partial);
      assert.equal(count(node),0,partial);
      assert.ok(node.textContent.includes(partial),partial);
    }
    assert.equal(count(render(source)),1);
  }
});
test('link hardening and no image loading', () => {
  const node = render('[https](https://example.com) [http](http://example.com) [mail](mailto:a@example.com) [relative](/path) [bad](javascript:alert) ![alt](https://evil.test/pixel)');
  const links = [...node.querySelectorAll('a')];
  for (const a of links.slice(0,3)) {assert.equal(a.target,'_blank'); assert.equal(a.rel,'noopener noreferrer');}
  for (const a of links.slice(3)) assert.equal(a.hasAttribute('href'),false);
  assert.equal(node.querySelector('img'),null);
});
test('same restrictive sanitizer policy with a permissive raw renderer', () => {
  const node = render('<p id="raw" name="raw" style="color:red" data-evil="1" onclick="alert(1)">safe</p><img src=x onerror=alert(1)><iframe src=x></iframe><form><input><button>x</button></form><svg onload="alert(1)"></svg><math><mi>x</mi></math><script>alert(1)</script>',{renderer:new window.marked.Renderer()});
  assert.equal(node.querySelector('script,img,iframe,form,input,button,svg,math,[id],[name],[style],[data-evil],[onclick]'),null);
  assert.ok(node.textContent.includes('safe'));
});
test('untrusted TeX commands cannot produce external resources or interactive HTML', () => {
  for (const tex of [String.raw`\href{javascript:alert(1)}{x}`,String.raw`\url{https://evil.test}`,String.raw`\includegraphics{https://evil.test/x}`,String.raw`\htmlClass{evil}{x}`,String.raw`\htmlStyle{background:url(https://evil.test)}{x}`,String.raw`\htmlId{evil}{x}`,String.raw`\htmlData{evil=1}{x}`,String.raw`\text{<img src=x onerror=alert(1)>}`]) {
    const node = render('\\(' + tex + '\\)');
    assert.equal(node.querySelector('a,img,iframe,script,[onerror],[onclick],[id],.evil'),null,tex);
    for (const element of node.querySelectorAll('[style]')) assert.ok(!element.getAttribute('style').includes('url('),tex);
  }
});
test('invalid, recursive, oversized TeX and isolated macro state safely fall back', () => {
  for (const tex of [String.raw`\notARealCommand{x}`,String.raw`\frac{`,String.raw`\def\x{\x}\x`]) {
    const node = render('\\(' + tex + '\\)');
    assert.equal(count(node),0);
    assert.equal(node.querySelector('.chat-math-fallback').textContent,'\\(' + tex + '\\)');
  }
  assert.equal(count(render('\\(' + 'x'.repeat(window.ChatMath.limits.maxLength + 1) + '\\)')),0);
  render(String.raw`\(\gdef\leak{x}\leak\)`);
  assert.equal(count(render(String.raw`\(\leak\)`)),0);
  const huge = render(String.raw`\(\rule{99999em}{99999em}\)`);
  for (const element of huge.querySelectorAll('[style]')) assert.ok(!element.getAttribute('style').includes('99999'));
});
test('per-render count and total-length budgets bound rendering work', () => {
  const maximum = window.ChatMath.limits.maxCount;
  const many = render(Array(maximum + 10).fill('\\(x\\)').join(' '));
  assert.equal(count(many),maximum);
  assert.ok(many.textContent.includes('\\(x\\)'));
  const long = '\\(' + 'x+'.repeat(1000) + 'x\\)';
  const total = render(Array(20).fill(long).join(' '));
  assert.equal(count(total),Math.floor(window.ChatMath.limits.maxTotalLength / 2001));
});
test('old and entity-encoded placeholder-like text never becomes math', () => {
  const old = '\uE000ChatMath000000000000000000000000000000001:0\uE001';
  assert.equal(count(render(old + ' &#xE000;ChatMath:0&#xE001;')),0);
  for (let i = 0; i < 3; i++) {
    const node = render(old + ' \\(x\\)');
    assert.equal(count(node),1); assert.ok(node.textContent.includes(old));
  }
});
test('custom marked instances retain extensions without global mutation', () => {
  const instance = new window.marked.Marked();
  instance.use({extensions:[{name:'sample',level:'inline',start:src => src.indexOf('@@'),tokenizer:src => src.startsWith('@@') ? {type:'sample',raw:'@@'} : undefined,renderer:() => '<strong>extension</strong>'}]});
  const before = instance.defaults.extensions.inline.length;
  assert.equal(render('@@ \\(x\\)',{marked:instance}).querySelector('strong').textContent,'extension');
  assert.equal(count(render('@@ \\(x\\)',{marked:instance})),1);
  assert.equal(instance.defaults.extensions.inline.length,before);
  assert.equal(window.marked.defaults.extensions,null);
});
test('missing KaTeX keeps original math readable and escaped', () => {
  const katex = window.katex; window.katex = undefined;
  try {const node = render(String.raw`\(x <img src=x>\)`); assert.equal(count(node),0); assert.equal(node.querySelector('img'),null); assert.ok(node.textContent.includes('\\(x <img src=x>\\)'));}
  finally {window.katex = katex;}
});
for (const file of ['chat.html','assistant.html']) {
  const html = await readFile(path.join(root,'public',file),'utf8');
  assert.ok(html.includes('href="vendor/chat/katex/katex.min.css"'));
  assert.ok(html.indexOf('src="vendor/chat/katex/katex.min.js"') < html.indexOf('src="chat-math.js"'));
  assert.ok(html.indexOf('src="chat-math.js"') < html.indexOf("script.src = location.protocol"));
}
const css = await readFile(path.join(root,'public/vendor/chat/katex/katex.min.css'),'utf8');
const fonts = [...css.matchAll(/url\((fonts\/[^)]+)\)/g)].map(match => match[1]);
assert.ok(fonts.length > 0);
for (const font of fonts) await readFile(path.join(root,'public/vendor/chat/katex',font));
assert.equal((await readdir(path.join(root,'public/vendor/chat/katex/fonts'))).length,60);
assert.ok((await readFile(path.join(root,'public/vendor/chat/katex/LICENSE'),'utf8')).includes('MIT License'));
dom.window.close();
console.log(`Chat math: ${checks} real-DOM suites passed; pinned local KaTeX, all ${fonts.length} CSS font URLs and both page includes verified.`);
