(() => {
  'use strict';
  const scriptURL = document.currentScript?.src;
  if (!scriptURL || window.ClubAssistant || window.parent !== window || /\/assistant\.html$/i.test(location.pathname)) return;
  const base = new URL('.', scriptURL);
  const copy = {
    zh: {title:'小铭 · 社团 AI 助手',open:'打开社团 AI 助手',close:'收起助手',expand:'放大窗口',restore:'还原窗口',stop:'停止生成',busy:'助手正在回复',loading:'正在打开助手…',failed:'助手加载未完成，可重试或在独立页面打开。',retry:'重试',standalone:'独立打开'},
    en: {title:'Xiaoming · Club AI Assistant',open:'Open Club AI Assistant',close:'Minimize assistant',expand:'Expand window',restore:'Restore window',stop:'Stop generating',busy:'Assistant is responding',loading:'Opening assistant…',failed:'The assistant has not loaded. Retry or open it in a separate page.',retry:'Retry',standalone:'Open separately'}
  };
  let root, ball, panel, frame, title, expand, close, stop, status, retry, standalone;
  let opened = false, expanded = false, busy = false, ready = false, timeout, previousFocus;
  let locked = [];
  const mobile = matchMedia('(max-width: 600px)');
  const lang = () => window.ClubI18n?.getLang?.() === 'en' || (!window.ClubI18n && document.documentElement.lang.startsWith('en')) ? 'en' : 'zh';
  const words = () => copy[lang()];
  function send(action, fields = {}) {
    frame?.contentWindow?.postMessage({type:'club-assistant',action,...fields}, location.protocol === 'file:' ? '*' : location.origin);
  }
  function sync() {
    send('sync',{lang:lang(),theme:document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',mode:window.ClubTheme?.getMode?.() || document.documentElement.dataset.theme || 'dark',modal:opened && mobile.matches});
  }
  function refresh() {
    if (!root) return;
    const text = words();
    title.textContent = text.title;
    ball.setAttribute('aria-label', busy ? `${text.open} · ${text.busy}` : text.open);
    ball.title = busy ? text.busy : text.open;
    expand.textContent = expanded ? '↙' : '↗';
    expand.setAttribute('aria-label', expanded ? text.restore : text.expand);
    expand.title = expanded ? text.restore : text.expand;
    close.setAttribute('aria-label',text.close); close.title = text.close;
    stop.textContent = text.stop;
    retry.textContent = text.retry;
    standalone.textContent = text.standalone;
    status.textContent = root.dataset.failed === 'true' ? text.failed : text.loading;
    if (frame) frame.title = text.title;
    sync();
  }
  function unlock() {
    for (const element of locked) element.inert = false;
    locked = [];
    document.documentElement.classList.remove('club-assistant-mobile-open');
  }
  function modalState() {
    unlock();
    const modal = opened && mobile.matches;
    panel.setAttribute('aria-modal',String(modal));
    if (!modal) return;
    document.documentElement.classList.add('club-assistant-mobile-open');
    for (const element of document.body.children) {
      if (element !== root && !element.inert && !['SCRIPT','STYLE','LINK'].includes(element.tagName)) {
        element.inert = true; locked.push(element);
      }
    }
  }
  function load() {
    if (frame) return;
    ready = false; root.dataset.failed = 'false';
    frame = document.createElement('iframe');
    frame.className = 'club-assistant-frame';
    frame.title = words().title;
    frame.src = new URL('assistant.html?embed=1',base).href;
    frame.setAttribute('allow','clipboard-write');
    frame.addEventListener('load',sync);
    panel.appendChild(frame);
    timeout = setTimeout(() => {
      if (!ready) { root.dataset.failed = 'true'; refresh(); }
    },20000);
  }
  function open() {
    if (!root || document.body.classList.contains('club-service-paused')) return;
    previousFocus = document.activeElement;
    opened = true; panel.hidden = false; ball.setAttribute('aria-expanded','true');
    root.classList.add('is-open');
    load(); modalState(); sync(); close.focus();
  }
  function minimize() {
    opened = false; panel.hidden = true; ball.setAttribute('aria-expanded','false');
    root.classList.remove('is-open'); unlock();
    const focus = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : ball;
    focus.focus?.({preventScroll:true});
  }
  function navigate(path) {
    if (typeof path !== 'string' || path.length > 512 || /[\\\u0000-\u001f]/.test(path)) return;
    let url;
    try { url = new URL(path,base); } catch { return; }
    const siteBase = new URL('../',base);
    const page = url.pathname.slice(siteBase.pathname.length);
    if (url.origin !== base.origin || !url.pathname.startsWith(siteBase.pathname) || !/^(?:public\/[A-Za-z0-9_-]+|index)\.html$/.test(page) || (url.hash && !/^#[A-Za-z0-9_-]+$/.test(url.hash)) || url.username || url.password || url.search) return;
    send('suspend');
    location.assign(url.href);
  }
  function receive(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== (location.protocol === 'file:' ? 'null' : location.origin)) return;
    const data = event.data;
    if (!data || data.type !== 'club-assistant' || typeof data.action !== 'string') return;
    if (data.action === 'ready') {
      ready = true; clearTimeout(timeout); root.dataset.failed = 'false'; root.dataset.ready = 'true'; sync();
    } else if (data.action === 'state' && typeof data.busy === 'boolean') {
      busy = data.busy; root.classList.toggle('is-busy',busy); stop.hidden = !busy; refresh();
    } else if (data.action === 'close') minimize();
    else if (data.action === 'focus' && opened && mobile.matches) {
      if (data.direction === 'next') (busy ? stop : close).focus();
      else if (data.direction === 'previous') close.focus();
    } else if (data.action === 'navigate') navigate(data.path);
    else if (data.action === 'sync') {
      if (['zh','en'].includes(data.lang) && data.lang !== lang()) window.ClubI18n?.setLang?.(data.lang);
      if (['auto','light','dark'].includes(data.mode) && data.mode !== window.ClubTheme?.getMode?.()) window.ClubTheme?.setMode?.(data.mode);
    }
  }
  function button(className, text) {
    const element = document.createElement('button');
    element.type = 'button'; element.className = className; element.textContent = text;
    return element;
  }
  function mount() {
    if (document.getElementById('club-assistant')) return;
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('assistant-launcher.css',base).href; document.head.appendChild(css);
    root = document.createElement('div'); root.id = 'club-assistant';
    if (/\/(?:platformer|snake|tetris)\.html$/i.test(location.pathname)) root.classList.add('club-assistant-game');
    ball = button('club-assistant-ball','✦');
    ball.setAttribute('aria-expanded','false'); ball.setAttribute('aria-controls','club-assistant-panel');
    ball.addEventListener('click',() => opened ? minimize() : open());
    panel = document.createElement('section'); panel.id = 'club-assistant-panel'; panel.className = 'club-assistant-panel'; panel.hidden = true;
    panel.setAttribute('role','dialog'); panel.setAttribute('aria-labelledby','club-assistant-title');
    const head = document.createElement('div'); head.className = 'club-assistant-head';
    title = document.createElement('strong'); title.id = 'club-assistant-title';
    stop = button('club-assistant-stop',''); stop.hidden = true; stop.addEventListener('click',() => send('stop'));
    expand = button('club-assistant-tool club-assistant-expand','↗'); expand.addEventListener('click',() => { expanded = !expanded; root.classList.toggle('is-expanded',expanded); refresh(); });
    close = button('club-assistant-tool','×'); close.addEventListener('click',minimize);
    head.append(title,stop,expand,close);
    const loading = document.createElement('div'); loading.className = 'club-assistant-loading';
    status = document.createElement('p'); status.setAttribute('role','status');
    retry = button('club-assistant-retry',''); retry.addEventListener('click',() => { send('suspend'); frame?.remove(); frame = null; root.dataset.ready = 'false'; clearTimeout(timeout); load(); refresh(); });
    standalone = document.createElement('a'); standalone.href = new URL('assistant.html',base).href; standalone.target = '_blank'; standalone.rel = 'noopener';
    loading.append(status,retry,standalone); panel.append(head,loading); root.append(ball,panel); document.body.appendChild(root);
    panel.addEventListener('keydown',event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); minimize(); }
      if (event.key === 'Tab' && mobile.matches) {
        if (event.shiftKey && document.activeElement === (busy ? stop : close)) { event.preventDefault(); frame?.focus(); send('focus',{direction:'last'}); }
        else if (!event.shiftKey && document.activeElement === close) { event.preventDefault(); frame?.focus(); send('focus',{direction:'first'}); }
      }
    });
    for (const type of ['pointerdown','click','keydown','keyup','wheel','touchstart','touchmove','touchend']) root.addEventListener(type,event => event.stopPropagation());
    window.addEventListener('message',receive);
    window.addEventListener('club:langchange',refresh);
    window.addEventListener('club:themechange',sync);
    window.addEventListener('club:thememodechange',sync);
    window.addEventListener('pagehide',() => send('suspend'));
    window.addEventListener('pageshow',sync);
    window.addEventListener('club:servicestate',() => { if (opened && document.body.classList.contains('club-service-paused')) { send('suspend'); minimize(); } });
    mobile.addEventListener('change',() => { modalState(); sync(); });
    refresh(); setTimeout(refresh,0);
  }
  window.ClubAssistant = {open:() => open(),close:() => minimize()};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})();
