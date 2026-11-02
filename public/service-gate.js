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
      const pillStyle = document.createElement('style');
      pillStyle.textContent = `
        #club-service-live-pill{box-sizing:border-box;position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483646;width:max-content;max-width:calc(100vw - 32px);padding:10px 16px;font-variant-numeric:tabular-nums;border:1px solid var(--club-line-strong,#454b52);border-radius:12px;font:500 13px/1.6 var(--club-font,"Inter Variable","MiSans VF","MiSans","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",system-ui,sans-serif);background:var(--club-material-panel,var(--club-surface,#181b1f));color:var(--club-text,#edf0f2);box-shadow:var(--club-material-shadow,0 8px 24px rgba(0,0,0,.2));text-align:center;overflow-wrap:anywhere;pointer-events:none}
        html[data-theme="light"] #club-service-live-pill{background:var(--club-material-panel,var(--club-surface,#fff));border-color:var(--club-line-strong,#cdd2db);color:var(--club-text,#17181c);box-shadow:var(--club-material-shadow,0 8px 24px rgba(23,24,28,.08))}
        #club-service-live-pill{
          --club-pointer-active:0;--club-service-pill-fill:var(--club-liquid-fallback,#162231);--club-service-pill-tint:var(--club-liquid-glass,rgba(18,29,44,.78));--club-service-pill-light:190,226,255;
          --club-service-pill-gloss:var(--club-liquid-wash,linear-gradient(155deg,rgba(211,235,255,.12),rgba(211,235,255,0) 42%));
          --club-service-pill-rim:var(--club-liquid-rim,rgba(224,243,255,.27));--club-service-pill-rim-low:var(--club-liquid-rim-low,rgba(8,17,29,.52));
          border-radius:20px;border-color:var(--club-liquid-line,rgba(151,192,218,.28));background-color:var(--club-service-pill-fill);
          background-image:radial-gradient(200px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-service-pill-light),calc(var(--club-pointer-active,0)*.075)),transparent 72%),var(--club-service-pill-gloss);
          box-shadow:inset 0 1px 0 var(--club-service-pill-rim),inset 0 -1px 0 var(--club-service-pill-rim-low),0 8px 24px rgba(0,7,18,.22);
        }
        html[data-theme="light"] #club-service-live-pill{
          --club-service-pill-fill:var(--club-liquid-fallback,#faf7f2);--club-service-pill-tint:var(--club-liquid-glass,rgba(255,252,247,.88));--club-service-pill-light:194,133,76;
          --club-service-pill-gloss:var(--club-liquid-wash,linear-gradient(155deg,rgba(255,255,255,.8),rgba(255,255,255,0) 44%,rgba(194,133,76,.035)));
          --club-service-pill-rim:var(--club-liquid-rim,rgba(255,255,255,.9));--club-service-pill-rim-low:var(--club-liquid-rim-low,rgba(108,93,74,.12));
          border-color:var(--club-liquid-line,rgba(108,93,74,.24));background-color:var(--club-service-pill-fill);
          background-image:radial-gradient(200px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-service-pill-light),calc(var(--club-pointer-active,0)*.075)),transparent 72%),var(--club-service-pill-gloss);
          box-shadow:inset 0 1px 0 var(--club-service-pill-rim),inset 0 -1px 0 var(--club-service-pill-rim-low),0 8px 24px rgba(53,61,73,.1);
        }
        @supports (backdrop-filter:blur(12px)) or (-webkit-backdrop-filter:blur(12px)){#club-service-live-pill,html[data-theme="light"] #club-service-live-pill{background-color:var(--club-service-pill-tint);-webkit-backdrop-filter:blur(12px) saturate(1.2);backdrop-filter:blur(12px) saturate(1.2)}}
        @media(prefers-reduced-transparency:reduce){#club-service-live-pill{background:var(--club-service-pill-fill)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}}
        @media(forced-colors:active){#club-service-live-pill{background:Canvas!important;color:CanvasText!important;border-color:CanvasText!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}}
        @media(prefers-reduced-motion:reduce){#club-service-live-pill{animation:none!important;transition:none!important;background-image:none!important}}
      `;
      (document.head || document.documentElement).appendChild(pillStyle);
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
    // Keep palette aliases local: the overlay theme can differ from the page theme.
    style.textContent = `
#club-service-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:var(--club-service-bg);color:var(--club-service-text);text-align:center}
#club-service-overlay[data-theme="light"]{background:var(--club-service-bg);color:var(--club-service-text)}
#club-service-overlay h1{margin:0 20px 16px;font-size:clamp(30px,5vw,52px)}
#club-service-overlay p{margin:0 20px;color:var(--club-service-muted);font-size:clamp(15px,2vw,18px);line-height:1.75;white-space:pre-wrap}
#club-service-overlay[data-theme="light"] p{color:var(--club-service-muted)}
#club-service-overlay .service-tools{display:flex;justify-content:center;align-items:center;gap:8px;margin-top:32px;padding-top:20px;border-top:1px solid var(--club-service-line);flex-wrap:wrap}
#club-service-overlay .service-tools a{text-decoration:none}
#club-service-overlay .service-admin{border-color:var(--club-service-accent)!important;color:var(--club-service-accent)!important;background-color:var(--club-service-soft)!important;font-weight:700}
#club-service-overlay .service-report,#club-service-overlay .service-tools [data-report]{border-color:var(--club-service-accent);color:var(--club-service-accent);font-weight:700}
#club-service-overlay .service-modal[hidden]{display:none}
#club-service-overlay .service-modal{position:fixed;inset:0;z-index:1;display:grid;place-items:center;padding:20px;background:var(--club-service-scrim);-webkit-backdrop-filter:none;backdrop-filter:none}
#club-service-overlay .service-modal-box{width:min(720px,100%);max-height:min(76vh,760px);overflow:auto;padding:32px;border:1px solid var(--club-service-edge);border-radius:20px;background:var(--club-service-panel);color:var(--club-service-text);text-align:left;box-shadow:var(--club-service-shadow);scrollbar-width:thin;scrollbar-color:var(--club-service-edge) var(--club-service-panel);overflow-wrap:anywhere}
#club-service-overlay .service-modal-box h1{margin:0 0 16px;font-size:26px;line-height:1.3}
#club-service-overlay .service-modal-box h2{font-size:21px}
#club-service-overlay .service-modal-box h3{font-size:17px}
#club-service-overlay .service-modal-box h4,#club-service-overlay .service-modal-box h5,#club-service-overlay .service-modal-box h6{font-size:15px}
#club-service-overlay .service-modal-box p{margin:0 0 10px;white-space:normal;font-size:15px}
#club-service-overlay .report-item{margin:7px 0;padding-left:15px;position:relative}
#club-service-overlay .report-item:before{content:"•";position:absolute;left:0}
#club-service-overlay .report-ordered{counter-increment:service-report}
#club-service-overlay .report-ordered:before{content:counter(service-report) "."}
#club-service-overlay .service-modal-box [data-report-content]{counter-reset:service-report}
#club-service-overlay .report-gap{height:7px}
#club-service-overlay .service-modal-box code{padding:2px 5px;border-radius:var(--club-radius-xs,6px);background:var(--club-service-inset);color:var(--club-service-text);font-family:var(--club-mono,"JetBrains Mono",ui-monospace,monospace)}
#club-service-overlay .service-modal-box pre{padding:16px;overflow:auto;border:1px solid var(--club-service-line);border-radius:6px;background:var(--club-service-inset)}
#club-service-overlay .service-modal-box pre code{padding:0;background:transparent}
#club-service-overlay .service-modal-box blockquote{margin:10px 0;padding:8px 13px;border-left:1px solid var(--club-service-accent);background:var(--club-service-panel);color:var(--club-service-text)}
#club-service-overlay .service-modal-box hr{border:0;border-top:1px solid var(--club-service-edge);margin:16px 0}
#club-service-overlay .service-modal-box img{max-width:100%;height:auto}
#club-service-overlay .service-modal-box a{padding:0;border:0;background:none;color:var(--club-service-accent);text-decoration:underline}
#club-service-overlay .report-table-wrap{overflow:auto;margin:20px 0;border:1px solid var(--club-service-edge);border-radius:6px;background:var(--club-service-read)}
#club-service-overlay .report-table{width:100%;min-width:560px;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
#club-service-overlay .report-table th,#club-service-overlay .report-table td{padding:12px;border-bottom:1px solid var(--club-service-line);text-align:left;vertical-align:top;line-height:1.55}
#club-service-overlay .report-table th{background:var(--club-service-control);color:var(--club-service-text);font-weight:700}
#club-service-overlay .report-table tr:last-child td{border-bottom:0}
#club-service-overlay .service-close{margin-top:24px}
#club-service-overlay>div:first-child{width:min(92vw,920px);max-width:100%;min-width:0;max-height:100vh;max-height:100dvh;padding:24px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:auto}
#club-service-overlay>div:first-child>h1,#club-service-overlay>div:first-child>p{width:100%;max-width:860px;min-width:0;margin-left:0;margin-right:0;overflow-wrap:anywhere;word-break:break-word;text-align:center}
#club-service-overlay>div:first-child>.service-tools{width:100%;max-width:860px;align-items:center}
body.club-service-paused> :not(#club-service-overlay){display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}
body.club-service-paused::before,body.club-service-paused::after{display:none!important;content:none!important}
body.club-service-paused{overflow:hidden!important;background:var(--club-bg,#101214)!important}
#club-service-overlay{isolation:isolate;opacity:1!important;visibility:visible!important;pointer-events:auto!important;background:var(--club-service-bg)!important}
#club-service-overlay[data-theme="light"]{background:var(--club-service-bg)!important}

#club-service-overlay{--club-service-bg:#101419;--club-service-text:#edf2f7;--club-service-muted:#a5b1bf;--club-service-read:#191f26;--club-service-control:#242f3c;--club-service-hover:#2c3a49;--club-service-inset:#131a22;--club-service-line:rgba(177,196,216,.17);--club-service-soft:rgba(58,212,230,.12);--club-service-panel:#1c2530;--club-service-scrim:rgba(5,10,16,.68);--club-service-control-finish:linear-gradient(180deg,rgba(221,237,250,.10),rgba(221,237,250,.015) 52%,rgba(4,12,24,.12));--club-service-control-rim:rgba(221,237,250,.16);--club-service-accent:#3ad4e6;--club-service-edge:rgba(177,196,216,.34);--club-service-shadow:0 20px 60px rgba(0,7,18,.32);font-family:var(--club-font,"Inter Variable","MiSans VF","MiSans","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",system-ui,sans-serif);color-scheme:dark}
#club-service-overlay[data-theme="light"]{--club-service-bg:#f3f1ec;--club-service-text:#182330;--club-service-muted:#5b615f;--club-service-read:#fffdfa;--club-service-control:#f7f4ee;--club-service-hover:#fffdf8;--club-service-inset:#e5e1d9;--club-service-line:rgba(119,103,83,.20);--club-service-soft:#fdf0ea;--club-service-panel:#f1eee8;--club-service-scrim:rgba(40,34,26,.30);--club-service-control-finish:linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,.08) 52%,rgba(108,93,74,.05));--club-service-control-rim:rgba(255,255,255,.92);--club-service-accent:#c2410c;--club-service-edge:rgba(119,103,83,.32);--club-service-shadow:0 20px 60px rgba(71,57,39,.14);color-scheme:light}
#club-service-overlay *{box-sizing:border-box}
#club-service-overlay h1{line-height:1.2;font-weight:740;text-wrap:balance}
#club-service-overlay .service-tools :is(button,a),#club-service-overlay .service-close{min-height:40px;padding:9px 14px;border:1px solid var(--club-service-edge);border-radius:var(--club-radius-sm,9px);background-color:var(--club-service-control);color:var(--club-service-text);font:inherit;font-size:13px;font-weight:600;line-height:1.5;cursor:pointer;transition:background-color .14s ease,border-color .14s ease,transform .14s ease}
#club-service-overlay .service-tools :is(button,a):hover,#club-service-overlay .service-close:hover{border-color:var(--club-service-accent);background-color:var(--club-service-hover)}
#club-service-overlay :is(button,a):focus-visible{outline:2px solid var(--club-service-accent);outline-offset:3px}
#club-service-overlay .service-tools :is(button,a):active,#club-service-overlay .service-close:active{transform:translateY(1px);box-shadow:inset 0 1px 2px rgba(0,7,18,.14)}
#club-service-overlay button:disabled{opacity:.5;cursor:not-allowed;transform:none}
#club-service-overlay [hidden]{display:none!important}
#club-service-overlay .service-modal-box :is(h2,h3,h4,h5,h6){margin:28px 0 12px;line-height:1.35}
#club-service-overlay .service-modal-box p{line-height:1.75}
#club-service-overlay .service-modal-box a{color:var(--club-service-accent);text-underline-offset:3px}
/* The gate itself and report body remain opaque; only the report frame is glass.
   Use overlay-local colors: its theme can intentionally differ from html. */
#club-service-overlay .service-modal-box{
  --club-pointer-active:0;--club-service-glass-fill:#162231;--club-service-glass-tint:rgba(18,29,44,.8);--club-service-light-rgb:190,226,255;
  --club-service-gloss:linear-gradient(155deg,rgba(211,235,255,.12),rgba(211,235,255,0) 42%,rgba(58,212,230,.025));
  --club-service-rim:rgba(224,243,255,.27);--club-service-rim-low:rgba(8,17,29,.52);
  border-radius:20px;border-color:rgba(151,192,218,.28);background-color:var(--club-service-glass-fill);
  background-image:radial-gradient(260px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-service-light-rgb),calc(var(--club-pointer-active,0)*.075)),transparent 72%),var(--club-service-gloss);
  box-shadow:inset 0 1px 0 var(--club-service-rim),inset 0 -1px 0 var(--club-service-rim-low),var(--club-service-shadow);
}
#club-service-overlay[data-theme="light"] .service-modal-box{
  --club-service-glass-fill:#faf7f2;--club-service-glass-tint:rgba(255,252,247,.88);--club-service-light-rgb:194,133,76;
  --club-service-gloss:linear-gradient(155deg,rgba(255,255,255,.8),rgba(255,255,255,0) 44%,rgba(194,133,76,.035));
  --club-service-rim:rgba(255,255,255,.9);--club-service-rim-low:rgba(108,93,74,.12);
  border-color:rgba(108,93,74,.24);background-color:var(--club-service-glass-fill);
  background-image:radial-gradient(260px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-service-light-rgb),calc(var(--club-pointer-active,0)*.075)),transparent 72%),var(--club-service-gloss);
}
@supports (backdrop-filter:blur(16px)) or (-webkit-backdrop-filter:blur(16px)){
  #club-service-overlay .service-modal-box,#club-service-overlay[data-theme="light"] .service-modal-box{background-color:var(--club-service-glass-tint);-webkit-backdrop-filter:blur(16px) saturate(1.2);backdrop-filter:blur(16px) saturate(1.2)}
}
#club-service-overlay .service-modal-box [data-report-content]{padding:20px;border-block:1px solid var(--club-service-line);background:var(--club-service-read);-webkit-backdrop-filter:none;backdrop-filter:none}
#club-service-overlay .service-modal-box :is(input,select,textarea){background:var(--club-service-read);color:var(--club-service-text);-webkit-backdrop-filter:none;backdrop-filter:none}
#club-service-overlay .service-tools :is(button,a),#club-service-overlay .service-close{
  --club-pointer-active:0;--club-service-control-light:190,226,255;
  -webkit-backdrop-filter:none;backdrop-filter:none;
  background-image:radial-gradient(120px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-service-control-light),calc(var(--club-pointer-active,0)*.04)),transparent 72%),var(--club-service-control-finish);
  box-shadow:inset 0 1px 0 var(--club-service-control-rim),0 2px 3px rgba(0,7,18,.08);
}
#club-service-overlay[data-theme="light"] .service-tools :is(button,a),#club-service-overlay[data-theme="light"] .service-close{
  --club-service-control-light:194,133,76;
}
@media(prefers-reduced-transparency:reduce){
  #club-service-overlay .service-modal-box{background:var(--club-service-glass-fill)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  #club-service-overlay .service-tools :is(button,a),#club-service-overlay .service-close{background-image:none!important}
}
@media(prefers-reduced-motion:reduce){#club-service-overlay .service-modal-box,#club-service-overlay .service-tools :is(button,a),#club-service-overlay .service-close{background-image:none!important}}
@media(forced-colors:active){
  #club-service-overlay,#club-service-overlay[data-theme],#club-service-overlay .service-modal,#club-service-overlay .service-modal-box,#club-service-overlay .service-modal-box [data-report-content]{background:Canvas!important;color:CanvasText!important;border-color:CanvasText!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  #club-service-overlay p{color:CanvasText!important}
  #club-service-overlay .service-modal-box :is(pre,code,blockquote,th,td){background:Canvas!important;color:CanvasText!important;border-color:CanvasText!important}
  #club-service-overlay .service-tools :is(button,a),#club-service-overlay .service-close,#club-service-overlay[data-theme] .service-tools :is(button,a){background:ButtonFace!important;color:ButtonText!important;border-color:ButtonText!important;box-shadow:none!important}
  #club-service-overlay .service-modal-box a{color:LinkText!important}
  #club-service-overlay :is(button,a):focus-visible{outline-color:Highlight!important}
}
#club-service-overlay ::selection{background:var(--club-service-accent);color:var(--club-service-panel)}
@media(max-width:640px){#club-service-overlay .service-modal{padding:16px}#club-service-overlay .service-modal-box{padding:20px 16px}#club-service-overlay .service-modal-box [data-report-content]{padding:16px 12px}}
@media(pointer:coarse){#club-service-overlay .service-tools :is(button,a),#club-service-overlay .service-close{min-height:44px;min-width:44px}}
@media(prefers-reduced-motion:reduce){#club-service-overlay,#club-service-overlay *{animation:none!important;transition:none!important;scroll-behavior:auto!important}#club-service-overlay .service-tools :is(button,a):active,#club-service-overlay .service-close:active{transform:none}}
    `;
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
