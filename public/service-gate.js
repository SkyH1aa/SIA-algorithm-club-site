(function () {
  const URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/club-drive';
  const KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const isAdminHub = /(?:^|\/)admin-hub\.html$/i.test(location.pathname);
  async function check() {
    if (isAdminHub) return;
    try {
      const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY }, body: JSON.stringify({ action: 'site_service_status' }) });
      const state = await res.json();
      if (state.enabled !== false) return;
      const lang = (localStorage.getItem('algorithm-club-lang') || 'zh').startsWith('en') ? 'en' : 'zh';
      const title = lang === 'en' ? (state.title_en || 'Website temporarily unavailable') : (state.title_zh || '网站暂不可用');
      const subtitle = lang === 'en' ? (state.subtitle_en || 'Website temporarily unavailable') : (state.subtitle_zh || '网站暂不可用');
      const style = document.createElement('style');
      style.textContent = '#club-service-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#080b14;color:#f7fbff;text-align:center;font-family:Inter,"Microsoft YaHei",sans-serif;pointer-events:auto}#club-service-overlay h1{margin:0 20px 14px;font-size:clamp(30px,6vw,64px);line-height:1.1}#club-service-overlay p{margin:0 20px;color:#a6b9ca;font-size:clamp(15px,2vw,21px);line-height:1.7;white-space:pre-wrap}';
      document.head.appendChild(style);
      const overlay = document.createElement('div'); overlay.id = 'club-service-overlay'; overlay.innerHTML = '<div><h1></h1><p></p></div>';
      overlay.querySelector('h1').textContent = title; overlay.querySelector('p').textContent = subtitle;
      document.body.appendChild(overlay);
      document.documentElement.style.overflow = 'hidden';
      document.querySelectorAll('button,a,input,select,textarea,[contenteditable="true"]').forEach(el => { el.setAttribute('tabindex', '-1'); el.setAttribute('disabled', 'disabled'); });
    } catch (_) { /* 服务状态接口不可用时保持页面正常，避免网络故障误停站 */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true }); else check();
})();
