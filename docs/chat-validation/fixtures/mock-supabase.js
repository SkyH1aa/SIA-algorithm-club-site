/* MOCK ONLY. This fixture ignores every URL/key passed to createClient. */
(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = null, inflight = null;
  function paint() {
    let banner = document.getElementById('chat-mock-banner');
    if (!banner) {
      banner = document.createElement('aside'); banner.id = 'chat-mock-banner';
      banner.setAttribute('aria-label','Local mock environment');
      // Inline styles are confined to this fixture, never the production stylesheets.
      banner.style.cssText = 'position:relative;z-index:2147483646;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#713f12;color:#fff7ed;font:14px/1.5 system-ui;border-bottom:3px solid #fbbf24';
      const label = document.createElement('strong'); label.dataset.mockLabel = '';
      const link = document.createElement('a'); link.href = '/setup'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'MOCK 设置 / 切换账号与场景'; link.style.color = '#fef3c7';
      banner.append(label,link); document.body.prepend(banner);
    }
    banner.querySelector('[data-mock-label]').textContent = `MOCK ONLY · ${snapshot?.account || 'loading'} · ${snapshot?.scenario || 'loading'} · 无线上 auth / DB / provider`;
  }
  function notify(event, session) {
    for (const entry of listeners) queueMicrotask(() => { if (listeners.has(entry)) entry.callback(event,structuredClone(session)); });
  }
  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const response = await fetch('/mock/session',{cache:'no-store'});
        if (!response.ok) throw new Error('mock_session');
        const next = await response.json();
        const previous = snapshot; snapshot = next;
        if (!previous) notify('INITIAL_SESSION',next.session);
        else if (previous.revision !== next.revision) notify(next.session ? 'SIGNED_IN' : 'SIGNED_OUT',next.session);
        if (document.body) paint();
        return next;
      } catch {
        // Fail closed if the mock server disappears: never restore a real session.
        if (snapshot?.session) { snapshot = {...snapshot,session:null,account:'offline'}; notify('SIGNED_OUT',null); }
        if (document.body) paint();
        return {session:null};
      } finally { inflight = null; }
    })();
    return inflight;
  }
  const auth = {
    async getSession() { const value = await refresh(); return {data:{session:structuredClone(value.session)},error:null}; },
    onAuthStateChange(callback) {
      const entry = {callback}; listeners.add(entry);
      if (snapshot) queueMicrotask(() => { if (listeners.has(entry)) callback('INITIAL_SESSION',structuredClone(snapshot.session)); });
      else void refresh();
      return {data:{subscription:{unsubscribe() { listeners.delete(entry); }}}};
    }
  };
  window.supabase = Object.freeze({createClient() { return Object.freeze({auth}); }});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',paint,{once:true}); else paint();
  setInterval(() => void refresh(),350);
  window.addEventListener('focus',() => void refresh());
  void refresh();
})();
