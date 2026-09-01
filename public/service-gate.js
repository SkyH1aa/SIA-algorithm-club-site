(function () {
  const URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/club-drive';
  const KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const isAdminHub = /(?:^|\/)admin-hub\.html$/i.test(location.pathname);
  const isTemporaryLogin = /(?:^|\/)member-center\.html$/i.test(location.pathname) && new URLSearchParams(location.search).get('serviceDebug') === '1';
  const FEATURE_BY_PATH = { 'member-center.html':'member-center', 'member-points.html':'points', 'points-mall.html':'mall', 'member-messages.html':'messages', 'drive.html':'drive', 'events.html':'events', 'join.html':'join', 'gomoku.html':'gomoku', 'tetris.html':'tetris', 'snake.html':'snake', 'platformer.html':'platformer', 'club-features.html':'club-features', 'visualization-lab.html':'visualization-lab', 'sorting-lab.html':'sorting-lab', 'search-lab.html':'search-lab', 'ds-lab.html':'ds-lab', 'graph-lab.html':'graph-lab', 'dp-lab.html':'dp-lab', 'tree-lab.html':'tree-lab', 'heap-lab.html':'heap-lab', 'resources.html':'resources', 'guide.html':'guide', 'changelog.html':'changelog' };
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
  if (!isAdminHub && !isTemporaryLogin) {
    document.documentElement.classList.add('club-service-checking');
    const earlyStyle = document.createElement('style');
    earlyStyle.textContent = 'html.club-service-checking body{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(earlyStyle);
    setTimeout(() => document.documentElement.classList.remove('club-service-checking'), 30000);
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
  async function check() {
    if (isAdminHub || isTemporaryLogin) return;
    const reveal = () => document.documentElement.classList.remove('club-service-checking');
    try {
      let state;
      try {
        const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY }, body: JSON.stringify({ action: 'site_service_status' }) });
        if (!res.ok) throw new Error('service status request failed');
        state = await res.json();
        latestState = state;
        window.dispatchEvent(new CustomEvent('club:servicestate', { detail: state }));
        localStorage.setItem('club-site-service-last-state', JSON.stringify(state));
      } catch (_) {
        try { state = JSON.parse(localStorage.getItem('club-site-service-last-state') || 'null'); } catch (_error) { state = null; }
        if (state) {
          latestState = state;
          window.dispatchEvent(new CustomEvent('club:servicestate', { detail: state }));
        }
        if (!state) { setTimeout(check, 1200); return; }
      }
      const feature = featureKey && state.feature_settings && state.feature_settings[featureKey];
      if (state.enabled !== false && (!feature || feature.enabled !== false)) { reveal(); return; }
      const prompts = Array.isArray(window.ClubServicePrompts) ? window.ClubServicePrompts : [];
      const pausedByFeature = Boolean(feature && feature.enabled === false);
      const selected = pausedByFeature
        ? (feature.random && prompts.length ? prompts[Math.floor(Math.random() * prompts.length)] : feature)
        : (state.random_enabled && prompts.length ? prompts[Math.floor(Math.random() * prompts.length)] : state);
      const lang = getLang();
      const title = lang === 'en' ? (selected.title_en || 'Website temporarily unavailable') : (selected.title_zh || '网站暂不可用');
      const subtitle = lang === 'en' ? (selected.subtitle_en || 'Website temporarily unavailable') : (selected.subtitle_zh || '网站暂不可用');
      const style = document.createElement('style');
      style.textContent = '#club-service-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#080b14;color:#f7fbff;text-align:center;font-family:Inter,"Microsoft YaHei",sans-serif}#club-service-overlay[data-theme="light"]{background:#f4eee9;color:#332a28}#club-service-overlay h1{margin:0 20px 14px;font-size:clamp(30px,6vw,64px)}#club-service-overlay p{margin:0 20px;color:#a6b9ca;font-size:clamp(15px,2vw,21px);line-height:1.7;white-space:pre-wrap}#club-service-overlay[data-theme="light"] p{color:#5f514c}.service-tools{display:flex;justify-content:center;gap:8px;margin-top:28px;flex-wrap:wrap}.service-tools button,.service-tools a{font:inherit;padding:9px 13px;border:1px solid #476176;border-radius:7px;background:#172638;color:#eaf7ff;text-decoration:none;cursor:pointer}.service-admin{border-color:#ff8564!important;color:#ffd7c8!important}.service-tools button:focus,.service-tools a:focus{outline:2px solid #ff8564}.service-report{border-color:#7ba8c9!important}.service-modal[hidden]{display:none}.service-modal{position:fixed;inset:0;z-index:1;display:grid;place-items:center;padding:20px;background:#0009}.service-modal-box{width:min(720px,100%);max-height:min(76vh,760px);overflow:auto;padding:24px;border:1px solid #476176;border-radius:10px;background:#101a2e;text-align:left}.service-modal-box h1{margin:0 0 16px;font-size:26px}.service-modal-box h2{font-size:22px}.service-modal-box h3{font-size:18px}.service-modal-box h4,.service-modal-box h5,.service-modal-box h6{font-size:16px}.service-modal-box p{margin:0 0 10px;white-space:normal;font-size:15px}.report-item{margin:7px 0;padding-left:15px;position:relative}.report-item:before{content:"•";position:absolute;left:0}.report-ordered{counter-increment:service-report}.report-ordered:before{content:counter(service-report) "."}.service-modal-box [data-report-content]{counter-reset:service-report}.report-gap{height:7px}.service-modal-box code{padding:2px 5px;border-radius:4px;background:#21304b}.service-modal-box pre{padding:12px;overflow:auto;border-radius:7px;background:#07101f}.service-modal-box pre code{padding:0;background:transparent}.service-modal-box blockquote{margin:10px 0;padding:8px 13px;border-left:3px solid #7ba8c9;background:#142239;color:#c9d9e8}.service-modal-box hr{border:0;border-top:1px solid #476176;margin:16px 0}.service-modal-box img{max-width:100%;height:auto}.service-modal-box a{padding:0;border:0;background:none;color:#7bdfff;text-decoration:underline}.report-table-wrap{overflow:auto;margin:14px 0;border:1px solid #385878;border-radius:7px}.report-table{width:100%;min-width:560px;border-collapse:collapse;font-size:14px}.report-table th,.report-table td{padding:10px 11px;border-bottom:1px solid #2b4561;text-align:left;vertical-align:top;line-height:1.55}.report-table th{background:#162942;color:#d9f4ff;font-weight:700}.report-table tr:last-child td{border-bottom:0}.service-close{margin-top:18px}#club-service-overlay[data-theme="light"] .service-tools button,#club-service-overlay[data-theme="light"] .service-tools a,#club-service-overlay[data-theme="light"] .service-modal-box{background:#fff8f4;border-color:#c9826d;color:#8d3f2e}#club-service-overlay[data-theme="light"] .service-modal-box pre{background:#f1dfd7}#club-service-overlay[data-theme="light"] .service-modal-box blockquote{border-color:#c9826d;background:#f5e4dc;color:#6a463a}#club-service-overlay[data-theme="light"] .service-modal-box a{color:#a63d28}#club-service-overlay[data-theme="light"] .report-table-wrap{border-color:#d69b87}#club-service-overlay[data-theme="light"] .report-table th{background:#f1d5cb;color:#6a291d}#club-service-overlay[data-theme="light"] .report-table th,#club-service-overlay[data-theme="light"] .report-table td{border-color:#e7c7bc}#club-service-overlay[data-theme="light"] .service-admin{background:#f3c8bb!important;border-color:#b83f28!important;color:#762714!important;text-shadow:none!important;font-weight:700}#club-service-overlay[data-theme="light"] .service-admin:hover{background:#e9ad9d!important;color:#5d1b0e!important}';
      style.textContent += '#club-service-overlay>div:first-child{width:min(92vw,920px);max-width:100%;min-width:0;max-height:100vh;padding:24px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:auto}#club-service-overlay>div:first-child>h1,#club-service-overlay>div:first-child>p{width:100%;max-width:860px;min-width:0;margin-left:0;margin-right:0;overflow-wrap:anywhere;word-break:break-word;text-align:center}#club-service-overlay>div:first-child>.service-tools{width:100%;max-width:860px;align-items:center}';
      document.head.appendChild(style);
      const overlay = document.createElement('div'); overlay.id = 'club-service-overlay'; overlay.innerHTML = '<div><h1></h1><p></p><div class="service-tools"><button type="button" data-report hidden></button><button type="button" data-lang="zh">中文</button><button type="button" data-lang="en">EN</button><button type="button" data-theme>日间</button><a class="service-admin" data-admin></a><a class="service-login" data-login></a></div></div><div class="service-modal" data-modal hidden><article class="service-modal-box"><div data-report-content></div><button class="service-close" type="button" data-close></button></article></div>';
      overlay.querySelector('h1').textContent = title; overlay.querySelector('p').textContent = subtitle;
      const themeBtn = overlay.querySelector('[data-theme]'); const admin = overlay.querySelector('[data-admin]'); const login = overlay.querySelector('[data-login]'); const reportBtn = overlay.querySelector('[data-report]'); const modal = overlay.querySelector('[data-modal]'); const reportContent = overlay.querySelector('[data-report-content]'); const closeBtn = overlay.querySelector('[data-close]');
      const refresh = () => { const en = getLang() === 'en'; const light = getTheme() === 'light'; const report = pausedByFeature ? '' : (en ? state.report_en : state.report_zh); overlay.dataset.theme = light ? 'light' : 'dark'; overlay.querySelector('h1').textContent = en ? (selected.title_en || 'Website temporarily unavailable') : (selected.title_zh || '网站暂不可用'); overlay.querySelector('p').textContent = en ? (selected.subtitle_en || 'Website temporarily unavailable') : (selected.subtitle_zh || '网站暂不可用'); themeBtn.textContent = light ? (en ? 'Dark mode' : '夜间') : (en ? 'Light mode' : '日间'); admin.textContent = en ? 'Administrator debug' : '管理员调试'; login.textContent = en ? 'Super-admin temporary login' : '超管临时登录'; reportBtn.hidden = !String(report || '').trim(); reportBtn.textContent = en ? 'View maintenance details' : '查看维护详情'; closeBtn.textContent = en ? 'Close' : '关闭'; reportContent.innerHTML = renderMarkdown(report); };
      overlay.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => { localStorage.setItem('algorithm-club-lang', btn.dataset.lang); refresh(); }));
      themeBtn.addEventListener('click', () => { localStorage.setItem('algorithm-club-theme-mode', getTheme() === 'light' ? 'dark' : 'light'); refresh(); });
      reportBtn.addEventListener('click', () => { modal.hidden = false; });
      closeBtn.addEventListener('click', () => { modal.hidden = true; });
      modal.addEventListener('click', event => { if (event.target === modal) modal.hidden = true; });
      admin.href = (location.pathname.includes('/public/') ? 'admin-hub.html' : 'public/admin-hub.html') + '?serviceDebug=1'; refresh();
      login.href = (location.pathname.includes('/public/') ? 'member-center.html' : 'public/member-center.html') + '?serviceDebug=1';
      setInterval(() => { if ((localStorage.getItem('algorithm-club-theme-mode') || 'auto') === 'auto') refresh(); }, 60000);
      document.body.appendChild(overlay);
      document.documentElement.style.overflow = 'hidden';
      document.querySelectorAll('button,a,input,select,textarea,[contenteditable="true"]').forEach(el => { el.setAttribute('tabindex', '-1'); el.setAttribute('disabled', 'disabled'); });
      overlay.querySelectorAll('button,a').forEach(el => { el.removeAttribute('disabled'); el.removeAttribute('tabindex'); });
      reveal();
    } catch (_) { reveal(); /* 服务状态接口不可用时保持页面正常，避免网络故障误停站 */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true }); else check();
})();
