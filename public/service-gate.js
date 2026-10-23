(function () {
  const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
  const URL = SUPABASE_URL + '/functions/v1/club-drive';
  const KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const isAdminHub = /(?:^|\/)admin-hub\.html$/i.test(location.pathname);
  // 故障页自身绝不能再执行服务门禁：404.html 也引入了本脚本，
  // 否则「路由到 404」会在 404 页上再次跳转，形成死循环。
  // 故障页文件名不用 502/503：GitHub Pages 会把 /503.html 当作自身错误页保留路径，
  // 覆盖掉仓库里的同名文件（502 也一并改名，避免同类问题）。
  const isErrorPage = /(?:^|\/)(?:404|bad-gateway|service-unavailable)\.html$/i.test(location.pathname);
  const isTemporaryLogin = /(?:^|\/)member-center\.html$/i.test(location.pathname) && new URLSearchParams(location.search).get('serviceDebug') === '1';
  const FEATURE_BY_PATH = { 'chat.html':'chat', 'member-center.html':'member-center', 'member-points.html':'points', 'points-mall.html':'mall', 'member-messages.html':'messages', 'drive.html':'drive', 'events.html':'events', 'join.html':'join', 'gomoku.html':'gomoku', 'tetris.html':'tetris', 'snake.html':'snake', 'platformer.html':'platformer', 'club-features.html':'club-features', 'visualization-lab.html':'visualization-lab', 'sorting-lab.html':'sorting-lab', 'search-lab.html':'search-lab', 'ds-lab.html':'ds-lab', 'graph-lab.html':'graph-lab', 'dp-lab.html':'dp-lab', 'tree-lab.html':'tree-lab', 'heap-lab.html':'heap-lab', 'resources.html':'resources', 'guide.html':'guide', 'changelog.html':'changelog', 'donations.html':'donations', 'notifications.html':'notifications', 'drive-admin.html':'drive-admin', 'member-profile.html':'member-profile', 'search.html':'search', 'gomoku-satori-lab.html':'gomoku-satori-lab' };
  const featureKey = FEATURE_BY_PATH[location.pathname.split('/').pop().toLowerCase()] || null;
  let latestState = null;
  window.ClubServiceGate = {
    getState: () => latestState,
    getFeature: key => latestState?.feature_settings?.[key] || null,
    isFeatureEnabled: key => latestState?.enabled !== false && latestState?.feature_settings?.[key]?.enabled !== false,
    getFeatureMessage: (key, lang = getLang()) => {
      const feature = latestState?.feature_settings?.[key] || {};
      const prompts = Array.isArray(window.ClubServicePrompts) ? window.ClubServicePrompts : [];
      const selected = feature.random && prompts.length ? prompts[Math.floor(Math.random() * prompts.length)] : feature;
      return {
        title: lang === 'en' ? (selected.title_en || 'This feature is temporarily unavailable') : (selected.title_zh || '该功能暂不可用'),
        subtitle: lang === 'en' ? (selected.subtitle_en || 'Please try again later.') : (selected.subtitle_zh || '请稍后再试。')
      };
    }
  };
  if (!isAdminHub && !isTemporaryLogin && !isErrorPage) {
    document.documentElement.classList.add('club-service-checking');
    const earlyStyle = document.createElement('style');
    earlyStyle.textContent = 'html.club-service-checking body{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(earlyStyle);
    // 兜底：即便首屏请求完全卡住，也不让页面一直隐藏。
    // 有缓存时 applyState 会立刻 reveal；这里只覆盖「无缓存 + 请求挂起」的极端情况。
    setTimeout(() => document.documentElement.classList.remove('club-service-checking'), 4000);
  }
  const getLang = () => (localStorage.getItem('algorithm-club-lang') || 'zh').startsWith('en') ? 'en' : 'zh';
  const getTheme = () => { const mode = localStorage.getItem('algorithm-club-theme-mode') || 'auto'; if (mode === 'light' || mode === 'dark') return mode; const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }).format(new Date())); return h >= 6 && h < 18 ? 'light' : 'dark'; };
  const escapeHtml = text => String(text || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  const renderMarkdown = text => {
    const inline = value => escapeHtml(value)
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong>$1$2</strong>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*]+)\*|(^|[^_])_([^_]+)_/g, '$1$3<em>$2$4</em>');
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const tableCells = line => line.trim().replace(/^\\?\|/, '').replace(/\|$/, '').split('|').map(cell => inline(cell.trim()));
    const isTableRule = line => /^\s*\\?\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
    const out = []; let inCode = false; let code = [];
    const flushCode = () => { if (!inCode) return; out.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>'); inCode = false; code = []; };
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index];
      if (/^```/.test(raw.trim())) { if (inCode) flushCode(); else inCode = true; continue; }
      if (inCode) { code.push(raw); continue; }
      if (raw.includes('|') && isTableRule(lines[index + 1] || '')) {
        const headers = tableCells(raw); const rows = [];
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(tableCells(lines[index])); index += 1; }
        index -= 1;
        const head = headers.map(cell => '<th>' + cell + '</th>').join('');
        const body = rows.map(row => '<tr>' + headers.map((_, cellIndex) => '<td>' + (row[cellIndex] || '') + '</td>').join('') + '</tr>').join('');
        out.push('<div class="report-table-wrap"><table class="report-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>');
        continue;
      }
      if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(raw)) { out.push('<hr>'); continue; }
      const heading = raw.match(/^(#{1,6})\s+(.+)$/); if (heading) { const level = heading[1].length; out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'); continue; }
      const quote = raw.match(/^>\s?(.*)$/); if (quote) { out.push('<blockquote>' + inline(quote[1]) + '</blockquote>'); continue; }
      const ordered = raw.match(/^\s*\d+[.)]\s+(.+)$/); if (ordered) { out.push('<div class="report-item report-ordered">' + inline(ordered[1]) + '</div>'); continue; }
      const bullet = raw.match(/^\s*[-*+]\s+(.+)$/); if (bullet) { out.push('<div class="report-item">' + inline(bullet[1]) + '</div>'); continue; }
      out.push(raw.trim() ? '<p>' + inline(raw) + '</p>' : '<div class="report-gap"></div>');
    }
    flushCode(); return out.join('');
  };

  // ---- 状态应用 ---------------------------------------------------------
  let overlay = null;
  let overlayCssReady = false;
  let lockedElements = [];
  let connState = 'init';
  let connSince = Date.now();
  let pill = null;
  let reconnects = 0;

  const setConn = state => {
    if (connState === state) return;
    connState = state; connSince = Date.now();
    try { window.dispatchEvent(new CustomEvent('club:serviceconn', { detail: { state } })); } catch (_error) { /* ignore */ }
    syncConnPill();
  };

  function syncConnPill() {
    const offline = connState === 'poll' || connState === 'down';
    if (!offline) { if (pill) pill.style.display = 'none'; return; }
    if (!document.body) return;
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'club-service-live-pill';
      pill.setAttribute('role', 'status');
      pill.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483646;padding:6px 12px;border-radius:999px;font:12px/1.5 Inter,"Microsoft YaHei",sans-serif;background:#7c2d12;color:#fff;box-shadow:0 4px 16px #0006;pointer-events:none';
      document.body.appendChild(pill);
    }
    pill.textContent = getLang() === 'en'
      ? 'Live updates unavailable — checking every 5s.'
      : '实时连接已断开，正在每 5 秒检查一次。';
    pill.style.display = '';
  }

  // 站点根路径：GitHub Pages 项目页是 /<repo>/，本地 file:// 是当前目录。
  function siteRoot() {
    if (location.protocol === 'file:') return './';
    const match = location.pathname.match(/^\/([^/]+)\//);
    if (/\.github\.io$/i.test(location.hostname) && match) return '/' + match[1] + '/';
    return '/';
  }

  // 解析展示方式：总开关关闭时由它统一决定；单个功能关闭时用该功能自己的设置。
  function resolveDisplay(reason, state) {
    const raw = reason.kind === 'site'
      ? state.display_mode
      : (reason.feature && reason.feature.display_mode);
    const mode = String(raw || 'overlay');
    return ['502', '503', '404'].includes(mode) ? mode : 'overlay';
  }

  // 配置值仍是 502/503/404（数据库约束与管理页下拉都用它），
  // 这里映射到实际文件名；404 保持原名。
  const ERROR_PAGE_FILES = { '502': 'bad-gateway.html', '503': 'service-unavailable.html', '404': '404.html' };

  let redirected = false;
  function routeToErrorPage(code) {
    if (redirected) return;
    redirected = true;
    // 用 replace：用户按返回键不该回到已被关闭的页面。
    location.replace(siteRoot() + (ERROR_PAGE_FILES[code] || '404.html'));
  }

  // 阻断原因：总开关优先，其次当前页面对应的功能开关。
  function blockReason(state) {
    if (!state) return null;
    if (state.enabled === false) return { kind: 'site', feature: null };
    const feature = featureKey && state.feature_settings && state.feature_settings[featureKey];
    if (feature && feature.enabled === false) return { kind: 'feature', feature };
    return null;
  }

  function reveal() { document.documentElement.classList.remove('club-service-checking'); }

  function restoreLocked() {
    for (const entry of lockedElements) {
      try {
        if (!entry.hadDisabled) entry.el.removeAttribute('disabled');
        if (!entry.hadTabindex) entry.el.removeAttribute('tabindex');
        else entry.el.setAttribute('tabindex', entry.tabindex);
      } catch (_error) { /* ignore */ }
    }
    lockedElements = [];
  }

  // 遮罩生效时把页面主体从 DOM 里摘下来存好，而不是只靠 CSS 盖住。
  // 原因：浏览器缩放、开发者工具、以及某些辅助技术可以绕过纯 CSS 覆盖看到下层内容。
  // 摘除后屏幕上只剩遮罩本身；解除时再原样放回，恢复后页面与之前完全一致。
  let detachedNodes = null;

  function detachPageContent() {
    if (detachedNodes || !document.body) return;
    detachedNodes = [];
    // 只摘 body 的直接子节点，保留 overlay 与状态提示条。
    for (const node of Array.from(document.body.children)) {
      if (node.id === 'club-service-overlay' || node.id === 'club-service-live-pill') continue;
      // script 标签保留，否则重新放回时脚本不会再次执行，但也不会丢失已定义的行为。
      detachedNodes.push({ node, next: node.nextSibling });
      try { node.remove(); } catch (_error) { /* ignore */ }
    }
  }

  function reattachPageContent() {
    if (!detachedNodes) return;
    for (const entry of detachedNodes) {
      try { document.body.insertBefore(entry.node, entry.next && entry.next.parentNode === document.body ? entry.next : null); }
      catch (_error) { try { document.body.appendChild(entry.node); } catch (_e) { /* ignore */ } }
    }
    detachedNodes = null;
  }

  function teardownOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.body.classList.remove('club-service-paused');
    document.documentElement.style.overflow = '';
    restoreLocked();
    reattachPageContent();
  }

  function selectedCopy(reason, state) {
    const prompts = Array.isArray(window.ClubServicePrompts) ? window.ClubServicePrompts : [];
    const feature = reason.feature;
    const useRandom = feature ? feature.random : state.random_enabled;
    return useRandom && prompts.length ? prompts[Math.floor(Math.random() * prompts.length)] : (feature || state);
  }

  function ensureOverlayCss() {
    if (overlayCssReady) return;
    const style = document.createElement('style');
    style.textContent = `#club-service-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#080b14;color:#f7fbff;text-align:center;font-family:Inter,"Microsoft YaHei",sans-serif}#club-service-overlay[data-theme="light"]{background:#f4eee9;color:#332a28}#club-service-overlay h1{margin:0 20px 14px;font-size:clamp(30px,6vw,64px)}#club-service-overlay p{margin:0 20px;color:#a6b9ca;font-size:clamp(15px,2vw,21px);line-height:1.7;white-space:pre-wrap}#club-service-overlay[data-theme="light"] p{color:#5f514c}.service-tools{display:flex;justify-content:center;gap:8px;margin-top:28px;flex-wrap:wrap}.service-tools button,.service-tools a{font:inherit;padding:9px 13px;border:1px solid #476176;border-radius:7px;background:#172638;color:#eaf7ff;text-decoration:none;cursor:pointer}.service-admin{border-color:#ff8564!important;color:#ffd7c8!important}.service-tools button:focus,.service-tools a:focus{outline:2px solid #ff8564}.service-report{border-color:#7ba8c9!important}.service-modal[hidden]{display:none}.service-modal{position:fixed;inset:0;z-index:1;display:grid;place-items:center;padding:20px;background:#0009}.service-modal-box{width:min(720px,100%);max-height:min(76vh,760px);overflow:auto;padding:24px;border:1px solid #476176;border-radius:10px;background:#101a2e;text-align:left}.service-modal-box h1{margin:0 0 16px;font-size:26px}.service-modal-box h2{font-size:22px}.service-modal-box h3{font-size:18px}.service-modal-box h4,.service-modal-box h5,.service-modal-box h6{font-size:16px}.service-modal-box p{margin:0 0 10px;white-space:normal;font-size:15px}.report-item{margin:7px 0;padding-left:15px;position:relative}.report-item:before{content:"•";position:absolute;left:0}.report-ordered{counter-increment:service-report}.report-ordered:before{content:counter(service-report) "."}.service-modal-box [data-report-content]{counter-reset:service-report}.report-gap{height:7px}.service-modal-box code{padding:2px 5px;border-radius:4px;background:#21304b}.service-modal-box pre{padding:12px;overflow:auto;border-radius:7px;background:#07101f}.service-modal-box pre code{padding:0;background:transparent}.service-modal-box blockquote{margin:10px 0;padding:8px 13px;border-left:3px solid #7ba8c9;background:#142239;color:#c9d9e8}.service-modal-box hr{border:0;border-top:1px solid #476176;margin:16px 0}.service-modal-box img{max-width:100%;height:auto}.service-modal-box a{padding:0;border:0;background:none;color:#7bdfff;text-decoration:underline}.report-table-wrap{overflow:auto;margin:14px 0;border:1px solid #385878;border-radius:7px}.report-table{width:100%;min-width:560px;border-collapse:collapse;font-size:14px}.report-table th,.report-table td{padding:10px 11px;border-bottom:1px solid #2b4561;text-align:left;vertical-align:top;line-height:1.55}.report-table th{background:#162942;color:#d9f4ff;font-weight:700}.report-table tr:last-child td{border-bottom:0}.service-close{margin-top:18px}#club-service-overlay[data-theme="light"] .service-tools button,#club-service-overlay[data-theme="light"] .service-tools a,#club-service-overlay[data-theme="light"] .service-modal-box{background:#fff8f4;border-color:#c9826d;color:#8d3f2e}#club-service-overlay[data-theme="light"] .service-modal-box pre{background:#f1dfd7}#club-service-overlay[data-theme="light"] .service-modal-box blockquote{border-color:#c9826d;background:#f5e4dc;color:#6a463a}#club-service-overlay[data-theme="light"] .service-modal-box a{color:#a63d28}#club-service-overlay[data-theme="light"] .report-table-wrap{border-color:#d69b87}#club-service-overlay[data-theme="light"] .report-table th{background:#f1d5cb;color:#6a291d}#club-service-overlay[data-theme="light"] .report-table th,#club-service-overlay[data-theme="light"] .report-table td{border-color:#e7c7bc}#club-service-overlay[data-theme="light"] .service-admin{background:#f3c8bb!important;border-color:#b83f28!important;color:#762714!important;text-shadow:none!important;font-weight:700}#club-service-overlay[data-theme="light"] .service-admin:hover{background:#e9ad9d!important;color:#5d1b0e!important}`;
    style.textContent += `#club-service-overlay>div:first-child{width:min(92vw,920px);max-width:100%;min-width:0;max-height:100vh;padding:24px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:auto}#club-service-overlay>div:first-child>h1,#club-service-overlay>div:first-child>p{width:100%;max-width:860px;min-width:0;margin-left:0;margin-right:0;overflow-wrap:anywhere;word-break:break-word;text-align:center}#club-service-overlay>div:first-child>.service-tools{width:100%;max-width:860px;align-items:center}body.club-service-paused> :not(#club-service-overlay){display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}body.club-service-paused::before,body.club-service-paused::after{display:none!important;content:none!important}body.club-service-paused{overflow:hidden!important;background:#080b14!important}#club-service-overlay{isolation:isolate;opacity:1!important;visibility:visible!important;pointer-events:auto!important;background:#080b14!important}#club-service-overlay[data-theme="light"]{background:#f4eee9!important}`;
    document.head.appendChild(style);
    overlayCssReady = true;
  }

  function renderOverlay(reason, state) {
    ensureOverlayCss();
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'club-service-overlay';
      overlay.innerHTML = '<div><h1></h1><p></p><div class="service-tools"><button type="button" data-report hidden></button><button type="button" data-lang="zh">中文</button><button type="button" data-lang="en">EN</button><button type="button" data-theme>日间</button><a class="service-admin" data-admin></a><a class="service-login" data-login></a></div></div><div class="service-modal" data-modal hidden><article class="service-modal-box"><div data-report-content></div><button class="service-close" type="button" data-close></button></article></div>';
      const themeBtn = overlay.querySelector('[data-theme]');
      const modal = overlay.querySelector('[data-modal]');
      overlay.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => {
        localStorage.setItem('algorithm-club-lang', btn.dataset.lang);
        if (overlay && overlay._reason) paintOverlay(overlay._reason, latestState);
      }));
      themeBtn.addEventListener('click', () => {
        localStorage.setItem('algorithm-club-theme-mode', getTheme() === 'light' ? 'dark' : 'light');
        if (overlay && overlay._reason) paintOverlay(overlay._reason, latestState);
      });
      overlay.querySelector('[data-report]').addEventListener('click', () => { modal.hidden = false; });
      overlay.querySelector('[data-close]').addEventListener('click', () => { modal.hidden = true; });
      modal.addEventListener('click', event => { if (event.target === modal) modal.hidden = true; });
      const base = location.pathname.includes('/public/') ? '' : 'public/';
      overlay.querySelector('[data-admin]').href = base + 'admin-hub.html?serviceDebug=1';
      overlay.querySelector('[data-login]').href = base + 'member-center.html?serviceDebug=1';
      overlay._reason = reason;
      document.body.classList.add('club-service-paused');
      document.body.appendChild(overlay);
      detachPageContent();
      document.documentElement.style.overflow = 'hidden';
      for (const el of document.querySelectorAll('button,a,input,select,textarea,[contenteditable="true"]')) {
        if (overlay.contains(el)) continue;
        lockedElements.push({
          el,
          hadDisabled: el.hasAttribute('disabled'),
          hadTabindex: el.hasAttribute('tabindex'),
          tabindex: el.getAttribute('tabindex')
        });
        el.setAttribute('tabindex', '-1');
        el.setAttribute('disabled', 'disabled');
      }
    }
    overlay._reason = reason;
    paintOverlay(reason, state);
  }

  function paintOverlay(reason, state) {
    if (!overlay) return;
    const selected = selectedCopy(reason, state);
    const en = getLang() === 'en';
    const light = getTheme() === 'light';
    overlay.dataset.theme = light ? 'light' : 'dark';
    overlay.querySelector('h1').textContent = en ? (selected.title_en || 'Website temporarily unavailable') : (selected.title_zh || '网站暂不可用');
    overlay.querySelector('p').textContent = en ? (selected.subtitle_en || 'Website temporarily unavailable') : (selected.subtitle_zh || '网站暂不可用');
    const themeBtn = overlay.querySelector('[data-theme]');
    themeBtn.textContent = light ? (en ? 'Dark mode' : '夜间') : (en ? 'Light mode' : '日间');
    overlay.querySelector('[data-admin]').textContent = en ? 'Administrator debug' : '管理员调试';
    overlay.querySelector('[data-login]').textContent = en ? 'Super-admin temporary login' : '超管临时登录';
    const report = reason.kind === 'site' ? (en ? state.report_en : state.report_zh) : '';
    const reportBtn = overlay.querySelector('[data-report]');
    reportBtn.hidden = !String(report || '').trim();
    reportBtn.textContent = en ? 'View maintenance details' : '查看维护详情';
    overlay.querySelector('[data-close]').textContent = en ? 'Close' : '关闭';
    overlay.querySelector('[data-report-content]').innerHTML = renderMarkdown(report);
  }

  // 单一入口：首屏、轮询、广播、跨标签都走这里。
  function applyState(state) {
    if (!state || typeof state !== 'object') return;
    latestState = state;
    try { localStorage.setItem('club-site-service-last-state', JSON.stringify(state)); } catch (_error) { /* 隐私模式忽略 */ }
    try { window.dispatchEvent(new CustomEvent('club:servicestate', { detail: state })); } catch (_error) { /* ignore */ }
    const reason = blockReason(state);
    if (reason) {
      const display = resolveDisplay(reason, state);
      if (display === 'overlay') renderOverlay(reason, state);
      else routeToErrorPage(display);
    } else {
      // 重新开启：若之前是遮罩就拆掉；若是跳转过，本页已经不在了。
      teardownOverlay();
      redirected = false;
    }
    reveal();
  }

  // ---- 权威状态读取 ------------------------------------------------------
  // 直接调 PostgREST 的 RPC，不经过 Edge Function，轮询成本更低。
  let stateSignature = '';
  async function fetchState() {
    const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/club_site_service_status', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: KEY },
      body: '{}',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('service status ' + response.status);
    const payload = await response.json();
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row || typeof row !== 'object') throw new Error('service status payload');
    const signature = String(row.updated_at || '') + '|' + String(row.enabled) + '|' + JSON.stringify(row.feature_settings || {});
    if (signature !== stateSignature) { stateSignature = signature; applyState(row); }
    setConn('live');
  }

  // ---- 实时订阅 ----------------------------------------------------------
  // 广播只是「有变化」的信号，绝不承载状态本身：收到后一律回源查询。
  // 即使有人伪造广播，也只能触发一次无害的重新读取，无法解锁功能。
  const REALTIME_CHANNEL = 'club-site-service-live-v1';
  let channel = null;
  let reconnectTimer = null;

  function connectRealtime() {
    const factory = window.supabase && window.supabase.createClient;
    if (!factory) { setConn('poll'); return; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try {
      const client = factory(SUPABASE_URL, KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 2 } }
      });
      channel = client.channel(REALTIME_CHANNEL, { config: { broadcast: { self: false } } });
      channel.on('broadcast', { event: 'service-changed' }, () => { void refresh('broadcast'); });
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          reconnects = 0;
          setConn('live');
          void refresh('subscribed');
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConn('poll');
          if (reconnectTimer) return;
          reconnects += 1;
          // 指数退避，最长 60 秒；期间由 5 秒轮询接管，不会漏状态。
          const delay = Math.min(60000, 2000 * Math.pow(2, Math.min(reconnects, 5)));
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            try { channel && channel.unsubscribe(); } catch (_error) { /* ignore */ }
            channel = null;
            connectRealtime();
          }, delay);
        }
      });
    } catch (_error) { setConn('poll'); }
  }

  async function refresh() {
    try { await fetchState(); }
    catch (_error) { setConn('poll'); }
  }

  // ---- 跨标签页同步 ------------------------------------------------------
  window.addEventListener('storage', event => {
    if (event.key === 'club-site-service-last-state' && event.newValue) {
      try { applyState(JSON.parse(event.newValue)); } catch (_error) { /* ignore */ }
    }
    if (event.key === 'club-site-service-poke') void refresh();
  });
  let broadcastChannel = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      broadcastChannel = new BroadcastChannel('club-site-service');
      broadcastChannel.onmessage = () => { void refresh(); };
    }
  } catch (_error) { broadcastChannel = null; }

  // 管理页保存后调用：只发「有变化」信号，不携带状态。
  window.ClubServiceGate.notifyChanged = () => {
    try { localStorage.setItem('club-site-service-poke', String(Date.now())); } catch (_error) { /* ignore */ }
    try { broadcastChannel && broadcastChannel.postMessage('changed'); } catch (_error) { /* ignore */ }
  };

  // 供测试与调试读取连接状态（只读，不能用来改变开关）。
  window.ClubServiceGate.getConnection = () => ({ state: connState, since: connSince });

  // ---- 启动 --------------------------------------------------------------
  let pollTimer = null;
  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    // 实时连通时 60 秒一次心跳，断开时 5 秒一次，确保不会长时间漏掉状态变化。
    const delay = connState === 'live' ? 60000 : 5000;
    pollTimer = setTimeout(async () => {
      await refresh();
      schedulePoll();
    }, delay);
  }

  async function check() {
    if (isAdminHub || isTemporaryLogin || isErrorPage) return;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('club-site-service-last-state') || 'null'); } catch (_error) { cached = null; }
    if (cached) applyState(cached); else reveal();
    await refresh();
    connectRealtime();
    schedulePoll();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { void refresh(); schedulePoll(); }
    });
    window.addEventListener('club:langchange', () => { if (overlay && overlay._reason) paintOverlay(overlay._reason, latestState); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true }); else check();
})();
