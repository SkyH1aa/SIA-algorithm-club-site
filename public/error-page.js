// 502 / 503 共用的页面渲染：从 club_error_pages 读取超管自定义文案，
// 只支持安全子集的 Markdown（标题/列表/链接/代码/表格/引用）。
// 超管永远不能注入任意 HTML 或脚本——这也是不提供整页 HTML 编辑的原因。
(function () {
  const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
  const KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';

  const lang = () => (localStorage.getItem('algorithm-club-lang') || 'zh').startsWith('en') ? 'en' : 'zh';
  const esc = text => String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 与 service-gate.js 相同的安全 Markdown 子集；不解析原始 HTML。
  function renderMarkdown(text) {
    const inline = value => esc(value)
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong>$1$2</strong>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*]+)\*|(^|[^_])_([^_]+)_/g, '$1$3<em>$2$4</em>');
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const cells = line => line.trim().replace(/^\\?\|/, '').replace(/\|$/, '').split('|').map(cell => inline(cell.trim()));
    const isRule = line => /^\s*\\?\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
    const out = [];
    let inCode = false;
    let code = [];
    const flush = () => { if (!inCode) return; out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); inCode = false; code = []; };
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index];
      if (/^```/.test(raw.trim())) { if (inCode) flush(); else inCode = true; continue; }
      if (inCode) { code.push(raw); continue; }
      if (raw.includes('|') && isRule(lines[index + 1] || '')) {
        const headers = cells(raw);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(cells(lines[index])); index += 1; }
        index -= 1;
        out.push('<div class="report-table-wrap"><table class="report-table"><thead><tr>' +
          headers.map(cell => '<th>' + cell + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(row => '<tr>' + headers.map((_, i) => '<td>' + (row[i] || '') + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }
      if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(raw)) { out.push('<hr>'); continue; }
      const heading = raw.match(/^(#{1,6})\s+(.+)$/);
      if (heading) { const level = heading[1].length; out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'); continue; }
      const quote = raw.match(/^>\s?(.*)$/);
      if (quote) { out.push('<blockquote>' + inline(quote[1]) + '</blockquote>'); continue; }
      const ordered = raw.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ordered) { out.push('<div class="report-item report-ordered">' + inline(ordered[1]) + '</div>'); continue; }
      const bullet = raw.match(/^\s*[-*+]\s+(.+)$/);
      if (bullet) { out.push('<div class="report-item">' + inline(bullet[1]) + '</div>'); continue; }
      out.push(raw.trim() ? '<p>' + inline(raw) + '</p>' : '<div class="report-gap"></div>');
    }
    flush();
    return out.join('');
  }

  // 只有站内相对链接或 http(s) 允许作为按钮目标，避免 javascript: 注入。
  function safeHref(href) {
    const value = String(href || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (/^\//.test(value)) return value;
    if (/^[A-Za-z0-9._~\-/#?=&%]+$/.test(value)) return value;
    return '';
  }

  const DEFAULTS = {
    502: { titleKey: 'errorPage.h502Title', leadKey: 'errorPage.h502Lead' },
    503: { titleKey: 'errorPage.h503Title', leadKey: 'errorPage.h503Lead' }
  };

  let rows = null;

  async function load() {
    if (rows) return rows;
    try {
      const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/club_error_pages_get', {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: KEY },
        body: '{}',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('error pages ' + response.status);
      const payload = await response.json();
      rows = Array.isArray(payload) ? payload : [];
    } catch (_error) {
      rows = [];
    }
    return rows;
  }

  function paint(code, row) {
    const en = lang() === 'en';
    const fallback = DEFAULTS[code] || {};
    const title = document.getElementById('errTitle');
    const subtitle = document.getElementById('errSubtitle');
    const body = document.getElementById('errBody');
    const retry = document.getElementById('errRetry');

    const customTitle = en ? row?.title_en : row?.title_zh;
    const customLead = en ? row?.subtitle_en : row?.subtitle_zh;
    const customBody = en ? row?.body_en : row?.body_zh;
    const customLabel = en ? row?.action_label_en : row?.action_label_zh;

    // 翻译缺键时 ClubI18n.t() 会原样返回 key（恒为真值），不能直接采用。
    // 只有「返回值和 key 不同」才算真正翻译成功，否则保留 HTML 里已经写好的默认文案。
    const translated = (key, node) => {
      if (!window.ClubI18n || !key) return node.textContent;
      const value = ClubI18n.t(key);
      return value && value !== key ? value : node.textContent;
    };
    if (title) {
      if (customTitle) title.textContent = customTitle;
      else title.textContent = translated(fallback.titleKey, title);
    }
    if (subtitle) {
      if (customLead) subtitle.textContent = customLead;
      else subtitle.textContent = translated(fallback.leadKey, subtitle);
    }
    if (body) body.innerHTML = customBody ? renderMarkdown(customBody) : '';

    // 主按钮：有自定义文案/链接就替换，否则保留页面内置的“重试 / 重新检查”。
    const href = safeHref(row?.action_href);
    if (retry && (customLabel || href)) {
      if (href) {
        const link = document.createElement('a');
        link.className = 'button';
        link.href = href;
        link.textContent = customLabel || retry.textContent;
        if (/^https?:\/\//i.test(href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        retry.replaceWith(link);
      } else if (customLabel) {
        retry.textContent = customLabel;
      }
    }
    document.title = (title?.textContent || 'Error') + ' · 算法社';
  }

  window.ClubErrorPage = {
    renderMarkdown,
    safeHref,
    async mount(code) {
      const paintNow = list => paint(code, (list || []).find(item => Number(item.code) === Number(code)));
      paintNow(rows || []);
      const list = await load();
      paintNow(list);
      // 语言切换后重绘（i18n 字典可能是延迟加载的）。
      window.addEventListener('club:langchange', () => paintNow(rows || []));
    }
  };
})();
