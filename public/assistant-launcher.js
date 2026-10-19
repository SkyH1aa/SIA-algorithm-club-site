(() => {
  'use strict';
  const scriptURL = document.currentScript?.src;
  if (!scriptURL || window.ClubAssistant || window.parent !== window || /\/assistant\.html$/i.test(location.pathname)) return;
  const base = new URL('.', scriptURL);
  const copy = {
    zh: {title:'小Bru · 社团 AI 助手',open:'打开社团 AI 助手',close:'收起助手',expand:'放大窗口',restore:'还原窗口',stop:'停止生成',busy:'助手正在回复',loading:'正在打开助手…',failed:'助手加载未完成，可重试或在独立页面打开。',retry:'重试',standalone:'独立打开',drag:'拖动移动位置',dragHint:'拖动标题栏移动窗口，双击复位'},
    en: {title:'Bru · Club AI Assistant',open:'Open Club AI Assistant',close:'Minimize assistant',expand:'Expand window',restore:'Restore window',stop:'Stop generating',busy:'Assistant is responding',loading:'Opening assistant…',failed:'The assistant has not loaded. Retry or open it in a separate page.',retry:'Retry',standalone:'Open separately',drag:'Drag to move',dragHint:'Drag the header to move; double-click to reset'}
  };
  let root, ball, panel, frame, title, expand, close, stop, status, retry, standalone, head;
  let opened = false, expanded = false, busy = false, ready = false, timeout, previousFocus;
  let locked = [];
  /* 位置存的是「左上角坐标」，渲染前一律按当前视口钳制，避免窗口缩小后跑到屏幕外。 */
  const PANEL_KEY = 'club-assistant-panel-position';
  const BALL_KEY = 'club-assistant-ball-position';
  const BALL_SIZE = 54, BALL_GAP = 12;
  let panelPosition = null, ballPosition = null, suppressClick = false;
  const mobile = matchMedia('(max-width: 600px)');
  const lang = () => window.ClubI18n?.getLang?.() === 'en' || (!window.ClubI18n && document.documentElement.lang.startsWith('en')) ? 'en' : 'zh';
  const words = () => copy[lang()];
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const viewport = () => ({
    width: Number(globalThis.innerWidth) > 0 ? globalThis.innerWidth : 1024,
    height: Number(globalThis.innerHeight) > 0 ? globalThis.innerHeight : 768
  });

  function send(action, fields = {}) {
    frame?.contentWindow?.postMessage({type:'club-assistant',action,...fields}, location.protocol === 'file:' ? '*' : location.origin);
  }
  /* 同步语言/主题/移动端模态给 iframe；iframe 就绪前后都可安全调用。 */
  function sync() {
    send('sync',{lang:lang(),theme:document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',mode:window.ClubTheme?.getMode?.() || document.documentElement.dataset.theme || 'dark',modal:opened && mobile.matches});
  }
  /* 存储不可用（隐私模式 / 沙箱 / 旧环境）时，位置只在本次会话内有效。 */
  const storage = (() => { try { return globalThis.localStorage || null; } catch (_error) { return null; } })();
  function readStored(key) {
    try {
      const value = JSON.parse(storage?.getItem(key) || 'null');
      return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? {x:value.x, y:value.y} : null;
    } catch (_error) { return null; }
  }
  function store(key, value) {
    try { storage?.setItem(key, JSON.stringify(value)); } catch (_error) { /* 隐私模式忽略 */ }
  }
  function forget(key) {
    try { storage?.removeItem(key); } catch (_error) { /* ignore */ }
  }

  /* ---------- 位置计算 ---------- */
  function ballSize() { return mobile.matches ? 48 : BALL_SIZE; }
  function defaultBall() {
    const {width, height} = viewport();
    return {x:width - ballSize() - BALL_GAP, y:height - ballSize() - BALL_GAP - 16};
  }
  function clampBall(position) {
    const size = ballSize(), gap = 6, {width, height} = viewport();
    return {x:clamp(position.x, gap, width - size - gap), y:clamp(position.y, gap, height - size - gap)};
  }
  function applyBall() {
    if (!ball) return;
    const position = clampBall(ballPosition || defaultBall());
    ballPosition = position;
    if (!ball.style) return;
    ball.style.inset = `${Math.round(position.y)}px auto auto ${Math.round(position.x)}px`;
  }
  /* 面板默认贴在悬浮球上方；一旦用户拖过，就沿用其坐标。 */
  function defaultPanel() {
    if (mobile.matches) return null;
    const view = viewport();
    const anchor = clampBall(ballPosition || defaultBall());
    const size = ballSize();
    const width = Math.min(420, view.width - 24);
    /* 为球预留高度，使面板永远不压住球；仍不足时取视口允许的最大高度。 */
    const maxHeight = Math.max(260, view.height - size - BALL_GAP * 2 - 24);
    const height = Math.min(620, maxHeight);
    const x = clamp(anchor.x + size - width, 12, view.width - width - 12);
    // 优先放在球上方；上方空间不够则把面板底边贴到球顶，必要时压缩到视口内。
    let y = anchor.y - BALL_GAP - height;
    if (y < 12) y = 12;
    return {x, y, height};
  }
  function clampPanel(position) {
    const view = viewport();
    /* 面板隐藏时 getBoundingClientRect 全是 0，必须回退到样式定义的尺寸，
       否则会把坐标钳到左上角 (8,8)。 */
    const rect = panel?.getBoundingClientRect?.() || {width:0, height:0};
    const width = rect.width > 0 ? rect.width : Math.min(420, view.width - 24);
    const height = rect.height > 0 ? rect.height : Math.min(620, view.height - 48);
    return {x: clamp(position.x, 8, view.width - width - 8), y: clamp(position.y, 8, view.height - height - 8)};
  }
  function applyPanel() {
    if (!panel) return;
    /* 移动端是整屏覆盖，交回 CSS 的 inset:0 规则，不能残留桌面端的坐标与高度。 */
    if (mobile.matches) {
      if (panel.style) { panel.style.inset = ''; panel.style.height = ''; }
      return;
    }
    const fallback = defaultPanel();
    const position = clampPanel(panelPosition || fallback || {x:12, y:12});
    panelPosition = position;
    if (!panel.style) return;
    /* CSS 里用了 inset，必须显式覆盖四个方向，否则 right/bottom 会把面板拉回去。 */
    panel.style.inset = `${Math.round(position.y)}px auto auto ${Math.round(position.x)}px`;
    /* 高度由脚本控制：CSS 固定 620px 会让面板压住悬浮球。 */
    const height = Number(fallback?.height) || 620;
    panel.style.height = `${Math.round(height)}px`;
  }

  /* ---------- 拖拽 ---------- */
  /* 统一的指针拖拽：pointerdown 记录偏移，pointermove 跟随，pointerup 落位并持久化。
     用 pointer events 同时覆盖鼠标、触摸和触控笔；拖动阈值避免误触发点击。 */
  function beginDrag(event, target, onMove) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const startX = event.clientX, startY = event.clientY;
    const origin = onMove.measure();
    let moved = false;
    const move = moveEvent => {
      const dx = moveEvent.clientX - startX, dy = moveEvent.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!moved) {
        moved = true;
        target.setPointerCapture?.(event.pointerId);
        target.classList.add('is-dragging');
        root.classList.add('is-dragging');
      }
      onMove.apply(dx, dy, origin);
      moveEvent.preventDefault();
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      target.classList.remove('is-dragging');
      root.classList.remove('is-dragging');
      if (moved) onMove.commit();
      onMove.done?.(moved);
    };
    target.setPointerCapture?.(event.pointerId);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    event.preventDefault();
  }

  function dragBall(event) {
    if (mobile.matches) return;
    beginDrag(event, ball, {
      measure: () => clampBall(ballPosition || defaultBall()),
      apply: (dx, dy, origin) => { ballPosition = clampBall({x:origin.x + dx, y:origin.y + dy}); applyBall(); },
      commit: () => store(BALL_KEY, ballPosition),
      /* 记录这次交互是否发生过位移，供随后的 click 判断是否要忽略。 */
      done: moved => { if (moved) suppressClick = true; }
    });
  }
  function dragPanel(event) {
    if (mobile.matches || expanded) return;
    /* 只从标题栏空白处拖动，避免抢走按钮的点击。 */
    if (event.target.closest?.('button,a')) return;
    beginDrag(event, head, {
      measure: () => clampPanel(panelPosition || defaultPanel() || {x:12, y:12}),
      apply: (dx, dy, origin) => { panelPosition = clampPanel({x:origin.x + dx, y:origin.y + dy}); applyPanel(); },
      commit: () => store(PANEL_KEY, panelPosition)
    });
  }
  function resetPanel() {
    if (mobile.matches) return;
    panelPosition = defaultPanel(); applyPanel();
    forget(PANEL_KEY);
  }

  function refresh() {
    if (!root) return;
    const text = words();
    title.textContent = text.title;
    ball.setAttribute('aria-label', busy ? `${text.open} · ${text.busy}` : text.open);
    ball.title = busy ? text.busy : text.open;
    if (head) head.title = text.dragHint;
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
    load(); modalState(); applyPanel(); sync(); if (ready) send('refreshCatalog'); close.focus();
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
    ball.addEventListener('click',() => {
      /* 拖拽结束后浏览器仍会补一次 click；suppressClick 由拖拽结束时的实际位移设置。 */
      if (suppressClick) { suppressClick = false; return; }
      opened ? minimize() : open();
    });
    ball.addEventListener('pointerdown', event => { suppressClick = false; dragBall(event); });
    ball.addEventListener('dblclick', () => { ballPosition = clampBall(defaultBall()); applyBall(); forget(BALL_KEY); });

    panel = document.createElement('section'); panel.id = 'club-assistant-panel'; panel.className = 'club-assistant-panel'; panel.hidden = true;
    panel.setAttribute('role','dialog'); panel.setAttribute('aria-labelledby','club-assistant-title');
    head = document.createElement('div'); head.className = 'club-assistant-head';
    const handle = document.createElement('span'); handle.className = 'club-assistant-handle'; handle.setAttribute('aria-hidden','true');
    title = document.createElement('strong'); title.id = 'club-assistant-title';
    stop = button('club-assistant-stop',''); stop.hidden = true; stop.addEventListener('click',() => send('stop'));
    expand = button('club-assistant-tool club-assistant-expand','↗'); expand.addEventListener('click',() => { expanded = !expanded; root.classList.toggle('is-expanded',expanded); applyPanel(); refresh(); });
    close = button('club-assistant-tool','×'); close.addEventListener('click',minimize);
    head.append(handle,title,stop,expand,close);
    head.addEventListener('pointerdown', dragPanel);
    head.addEventListener('dblclick', event => { if (!event.target.closest?.('button,a')) resetPanel(); });
    const loading = document.createElement('div'); loading.className = 'club-assistant-loading';
    status = document.createElement('p'); status.setAttribute('role','status');
    retry = button('club-assistant-retry',''); retry.addEventListener('click',() => { send('suspend'); frame?.remove(); frame = null; root.dataset.ready = 'false'; clearTimeout(timeout); load(); refresh(); });
    standalone = document.createElement('a'); standalone.href = new URL('assistant.html',base).href; standalone.target = '_blank'; standalone.rel = 'noopener';
    loading.append(status,retry,standalone); panel.append(head,loading); root.append(ball,panel); document.body.appendChild(root);

    /* 恢复上次位置；移动端不恢复，避免覆盖式布局错位。 */
    ballPosition = clampBall(readStored(BALL_KEY) || defaultBall());
    panelPosition = readStored(PANEL_KEY);
    applyBall();
    if (panelPosition) applyPanel();

    panel.addEventListener('keydown',event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); minimize(); }
      if (event.key === 'Tab' && mobile.matches) {
        if (event.shiftKey && document.activeElement === (busy ? stop : close)) { event.preventDefault(); frame?.focus(); send('focus',{direction:'last'}); }
        else if (!event.shiftKey && document.activeElement === close) { event.preventDefault(); frame?.focus(); send('focus',{direction:'first'}); }
      }
    });
    /* 只在浮球和面板内部拦截事件，避免页面其它区域的滚轮/快捷键被容器吞掉。 */
    for (const type of ['pointerdown','click','keydown','keyup','wheel','touchstart','touchmove','touchend']) {
      ball.addEventListener(type,event => event.stopPropagation());
      panel.addEventListener(type,event => event.stopPropagation());
    }
    window.addEventListener('message',receive);
    window.addEventListener('club:langchange',refresh);
    window.addEventListener('club:themechange',sync);
    window.addEventListener('club:thememodechange',sync);
    window.addEventListener('pagehide',() => send('suspend'));
    window.addEventListener('pageshow',sync);
    window.addEventListener('club:servicestate',() => { if (opened && document.body.classList.contains('club-service-paused')) { send('suspend'); minimize(); } });
    window.addEventListener('resize',() => { applyBall(); applyPanel(); });
    mobile.addEventListener('change',() => { modalState(); applyBall(); applyPanel(); sync(); });
    refresh(); setTimeout(refresh,0);
  }
  window.ClubAssistant = {open:() => open(),close:() => minimize()};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})();
