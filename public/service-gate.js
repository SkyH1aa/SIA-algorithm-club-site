(function () {
  const URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/club-drive';
  const KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const isAdminHub = /(?:^|\/)admin-hub\.html$/i.test(location.pathname);
  const getLang = () => (localStorage.getItem('algorithm-club-lang') || 'zh').startsWith('en') ? 'en' : 'zh';
  const getTheme = () => { const mode = localStorage.getItem('algorithm-club-theme-mode') || 'auto'; if (mode === 'light' || mode === 'dark') return mode; const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }).format(new Date())); return h >= 6 && h < 18 ? 'light' : 'dark'; };
  async function check() {
    if (isAdminHub) return;
    try {
      const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY }, body: JSON.stringify({ action: 'site_service_status' }) });
      const state = await res.json();
      if (state.enabled !== false) return;
      const lang = getLang();
      const title = lang === 'en' ? (state.title_en || 'Website temporarily unavailable') : (state.title_zh || '网站暂不可用');
      const subtitle = lang === 'en' ? (state.subtitle_en || 'Website temporarily unavailable') : (state.subtitle_zh || '网站暂不可用');
      const style = document.createElement('style');
      style.textContent = '#club-service-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#080b14;color:#f7fbff;text-align:center;font-family:Inter,"Microsoft YaHei",sans-serif}#club-service-overlay[data-theme="light"]{background:#f4eee9;color:#332a28}#club-service-overlay h1{margin:0 20px 14px;font-size:clamp(30px,6vw,64px)}#club-service-overlay p{margin:0 20px;color:#a6b9ca;font-size:clamp(15px,2vw,21px);line-height:1.7;white-space:pre-wrap}#club-service-overlay[data-theme="light"] p{color:#5f514c}.service-tools{display:flex;justify-content:center;gap:8px;margin-top:28px;flex-wrap:wrap}.service-tools button,.service-tools a{font:inherit;padding:9px 13px;border:1px solid #476176;border-radius:7px;background:#172638;color:#eaf7ff;text-decoration:none;cursor:pointer}.service-admin{border-color:#ff8564!important;color:#ffb29e!important}.service-tools button:focus,.service-tools a:focus{outline:2px solid #ff8564}#club-service-overlay[data-theme="light"] .service-tools button,#club-service-overlay[data-theme="light"] .service-tools a{background:#fff8f4;border-color:#c9826d;color:#8d3f2e}#club-service-overlay[data-theme="light"] .service-admin{background:#c54a34;color:#fff!important}';
      document.head.appendChild(style);
      const overlay = document.createElement('div'); overlay.id = 'club-service-overlay'; overlay.innerHTML = '<div><h1></h1><p></p><div class="service-tools"><button type="button" data-lang="zh">中文</button><button type="button" data-lang="en">EN</button><button type="button" data-theme>日间</button><a class="service-admin" data-admin></a></div></div>';
      overlay.querySelector('h1').textContent = title; overlay.querySelector('p').textContent = subtitle;
      const themeBtn = overlay.querySelector('[data-theme]'); const admin = overlay.querySelector('[data-admin]');
      const refresh = () => { const en = getLang() === 'en'; const light = getTheme() === 'light'; overlay.dataset.theme = light ? 'light' : 'dark'; overlay.querySelector('h1').textContent = en ? (state.title_en || 'Website temporarily unavailable') : (state.title_zh || '网站暂不可用'); overlay.querySelector('p').textContent = en ? (state.subtitle_en || 'Website temporarily unavailable') : (state.subtitle_zh || '网站暂不可用'); themeBtn.textContent = light ? (en ? 'Dark mode' : '夜间') : (en ? 'Light mode' : '日间'); admin.textContent = en ? 'Administrator debug' : '管理员调试'; };
      overlay.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => { localStorage.setItem('algorithm-club-lang', btn.dataset.lang); refresh(); }));
      themeBtn.addEventListener('click', () => { localStorage.setItem('algorithm-club-theme-mode', getTheme() === 'light' ? 'dark' : 'light'); refresh(); });
      admin.href = (location.pathname.includes('/public/') ? 'admin-hub.html' : 'public/admin-hub.html') + '?serviceDebug=1'; refresh();
      setInterval(() => { if ((localStorage.getItem('algorithm-club-theme-mode') || 'auto') === 'auto') refresh(); }, 60000);
      document.body.appendChild(overlay);
      document.documentElement.style.overflow = 'hidden';
      document.querySelectorAll('button,a,input,select,textarea,[contenteditable="true"]').forEach(el => { el.setAttribute('tabindex', '-1'); el.setAttribute('disabled', 'disabled'); });
      overlay.querySelectorAll('button,a').forEach(el => { el.removeAttribute('disabled'); el.removeAttribute('tabindex'); });
    } catch (_) { /* 服务状态接口不可用时保持页面正常，避免网络故障误停站 */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true }); else check();
})();
