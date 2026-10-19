/* Shared classic-script renderer. KaTeX 0.19.0 is loaded from vendor/chat/katex/.
 * API: ChatMath.renderMarkdown(text, {marked, DOMPurify, renderer, decorateCode})
 * Returns a DocumentFragment. Raw conversation/copy text remains the caller's data.
 */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({maxLength:4096, maxCount:128, maxTotalLength:32768, maxExpand:100, maxSize:20});
  const POLICY = Object.freeze({
    RETURN_DOM_FRAGMENT:true,
    FORBID_TAGS:['img','style','iframe','form','input','button','svg','math'],
    FORBID_ATTR:['style','id','name'], ALLOW_DATA_ATTR:false
  });
  let sequence = 0;
  const escapeHtml = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function nonce(text) {
    let value;
    do {
      const bytes = new Uint32Array(4);
      if (root.crypto?.getRandomValues) root.crypto.getRandomValues(bytes);
      else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 0x100000000);
      value = 'ChatMath' + Array.from(bytes, byte => byte.toString(16).padStart(8, '0')).join('') + (++sequence).toString(16);
    } while (text.includes(value));
    return value;
  }
  function escaped(text, index) {
    let count = 0;
    while (index > 0 && text[--index] === '\\') count++;
    return count % 2 === 1;
  }
  // Single dollars deliberately exclude money/numeric-only pairs and whitespace
  // edges. Use \(...\) for ambiguous numeric math. Never guess an absent closer.
  function readMath(src, previous) {
    let open, close, display = false;
    if (src.startsWith('\\(')) { open = '\\('; close = '\\)'; }
    else if (src.startsWith('\\[')) { open = '\\['; close = '\\]'; display = true; }
    else if (src.startsWith('$$')) { open = close = '$$'; display = true; }
    else if (src[0] === '$' && !/[\w$\\]/.test(previous || '') && src[1] && !/\s|\d|\$/.test(src[1])) { open = close = '$'; }
    else return null;
    // Bound ambiguous-dollar lookahead, even in a long adversarial prose line.
    const search = open === '$' ? src.slice(0, LIMITS.maxLength + 2) : src;
    const endOfLine = search.indexOf('\n', open.length);
    const searchEnd = display || endOfLine < 0 ? search.length : endOfLine;
    let end = search.indexOf(close, open.length);
    while (end >= 0 && end < searchEnd && (escaped(src, end) || (open === '$' && (src[end - 1] === '$' || src[end + 1] === '$' || /\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || ''))))) {
      end = search.indexOf(close, end + close.length);
    }
    if (end < 0 || end >= searchEnd) {
      // Keep partial explicit delimiters intact instead of marked consuming '\\'.
      if (open === '$') return null;
      const partial = src.slice(0, searchEnd);
      const code = partial.search(/`|^ {0,3}~{3,}/m);
      return {raw:code < 0 ? partial : partial.slice(0, code), literal:true, display};
    }
    const raw = src.slice(0, end + close.length), tex = src.slice(open.length, end);
    // A stray opener must not swallow a subsequent real Markdown code block
    // or codespan. Leave that content to marked's native code tokenizer.
    if (/`|^ {0,3}~{3,}/m.test(tex)) return {raw:open, literal:true, display};
    return {raw, tex, display, literal:!tex.trim()};
  }
  function renderMarkdown(value, options) {
    const text = String(value ?? '');
    const marked = options?.marked || root.marked;
    const purify = options?.DOMPurify || root.DOMPurify;
    if (!marked?.parse || !purify?.sanitize) throw new TypeError('ChatMath requires marked and DOMPurify');
    const tokens = [], prefix = '\uE000' + nonce(text) + ':';
    let totalLength = 0;
    const mathToken = match => {
      if (!match) return undefined;
      if (match.literal || match.tex.length > LIMITS.maxLength || tokens.length >= LIMITS.maxCount || totalLength + match.tex.length > LIMITS.maxTotalLength) {
        return {type:'chatMathLiteral', raw:match.raw, text:match.raw};
      }
      const token = {type:'chatMath', ...match, marker:prefix + tokens.length + '\uE001'};
      tokens.push(token); totalLength += match.tex.length;
      return token;
    };
    // Extensions are local to this parse: no marked.use(), shared renderer edits,
    // or persistent macro state. Native marked fences/codespans remain atomic.
    const existing = marked.defaults?.extensions || {};
    const extensions = {
      ...existing,
      block:[function (src) {
        if (!src.startsWith('$$') && !src.startsWith('\\[')) return;
        return mathToken(readMath(src, ''));
      }, ...(existing.block || [])],
      inline:[function (src, prior) {
        const previous = prior.length ? prior[prior.length - 1].raw.slice(-1) : '';
        return mathToken(readMath(src, previous));
      }, ...(existing.inline || [])],
      startBlock:[function (src) { const match = /^(?:\$\$|\\\[)/m.exec(src); return match ? match.index : undefined; }, ...(existing.startBlock || [])],
      startInline:[function (src) { const index = src.search(/\$|\\[([]/); return index < 0 ? undefined : index; }, ...(existing.startInline || [])],
      renderers:{...existing.renderers, chatMath:token => token.marker, chatMathLiteral:token => escapeHtml(token.text)}
    };
    let renderer = options?.renderer;
    if (!renderer) {
      renderer = new marked.Renderer();
      renderer.html = ({text:html}) => escapeHtml(html);
      renderer.image = ({text:alt}) => escapeHtml('[' + (alt || 'image') + ']');
    }
    const html = marked.parse(text, {renderer, extensions, async:false});
    const fragment = purify.sanitize(html, POLICY);
    if (!fragment || fragment.nodeType !== 11) throw new TypeError('ChatMath requires a DOMPurify DocumentFragment');
    const doc = fragment.ownerDocument;
    // Restore only this render's authenticated tokens in text nodes. Never
    // rewrite HTML strings or attributes after sanitization.
    const walker = doc.createTreeWalker(fragment, 4);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.data.includes(prefix)) nodes.push(walker.currentNode);
    const byMarker = new Map(tokens.map(token => [token.marker, token]));
    for (const node of nodes) {
      if (node.parentElement?.closest('pre,code,textarea,script,style,option')) continue;
      const parts = doc.createDocumentFragment();
      let offset = 0, index;
      while ((index = node.data.indexOf(prefix, offset)) >= 0) {
        const end = node.data.indexOf('\uE001', index + prefix.length);
        if (end < 0) break;
        const marker = node.data.slice(index, end + 1), token = byMarker.get(marker);
        parts.append(doc.createTextNode(node.data.slice(offset, index)));
        if (!token) parts.append(doc.createTextNode(marker));
        else {
          const element = doc.createElement('span');
          element.className = token.display ? 'chat-math chat-math-display' : 'chat-math chat-math-inline';
          try {
            if (!root.katex?.render) throw new Error('KaTeX unavailable');
            root.katex.render(token.tex, element, {
              displayMode:token.display, throwOnError:true, trust:false, strict:'error',
              maxExpand:LIMITS.maxExpand, maxSize:LIMITS.maxSize,
              output:'htmlAndMathml', macros:Object.create(null), globalGroup:false
            });
          } catch {
            element.classList.add('chat-math-fallback');
            element.textContent = token.raw;
          }
          parts.append(element);
        }
        offset = end + 1;
      }
      parts.append(doc.createTextNode(node.data.slice(offset)));
      node.replaceWith(parts);
    }
    for (const link of fragment.querySelectorAll('a')) {
      try {
        const url = new root.URL(link.getAttribute('href'));
        if (!['https:','http:','mailto:'].includes(url.protocol)) throw new Error('protocol');
        link.rel = 'noopener noreferrer'; link.target = '_blank';
      } catch { link.removeAttribute('href'); }
    }
    if (typeof options?.decorateCode === 'function') options.decorateCode(fragment);
    return fragment;
  }
  root.ChatMath = Object.freeze({renderMarkdown, limits:LIMITS, katexVersion:'0.19.0'});
})(globalThis);
