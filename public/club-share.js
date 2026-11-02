// 站内分享：优先系统分享面板，其次微信/QQ 深链，最后复制链接。
//
// 现实约束（决定了实现方式）：
// * 桌面微信没有可用的「发消息」URL scheme。weixin:// 只能唤起客户端本身，
//   不能把链接预填到某个聊天窗口。因此电脑端走「复制链接 + 提示粘贴」。
// * 手机 / iPad 上 Web Share API（navigator.share）会弹出系统分享面板，
//   其中包含微信、QQ，这是唯一能真正“一步转发到微信”的可靠通道。
// * 部分安卓浏览器支持 scheme：weixin://send?text=... 与 mqqapi://share/to_fri?...
//   作为 Web Share 不可用时的补充；失败就回退到复制。
//
// 对外 API：
//   ClubShare.share({ title, text, url })   → Promise<'shared'|'copied'|'cancelled'|'failed'>
//   ClubShare.openWeChat()                  → 尝试唤起微信客户端
//   ClubShare.openQQ()                      → 尝试唤起 QQ
//   ClubShare.copy(url)                     → Promise<boolean>
(() => {
  var global = typeof window !== 'undefined' ? window : globalThis;

  // Inject only sheet/feedback styles: sharing and client handoff stay unchanged.
  function injectStyle() {
    if (document.getElementById('club-share-style')) return;
    var style = document.createElement('style');
    style.id = 'club-share-style';
    style.textContent = `
      .club-share-layer,.club-share-toast{
        --club-share-panel:var(--club-metal-panel,#1c2530);
        --club-share-read:var(--club-material-read,var(--club-surface,#191f26));
        --club-share-control:var(--club-material-control,#242f3c);--club-share-hover:var(--club-material-hover,#2c3a49);
        --club-share-control-finish:var(--club-metal-control-finish,linear-gradient(180deg,rgba(221,237,250,.10),rgba(221,237,250,.015) 52%,rgba(4,12,24,.12)));
        --club-share-control-rim:rgba(221,237,250,.16);
        --club-share-text:var(--club-text,#edf0f2);--club-share-muted:var(--club-muted,#a0a9b2);
        --club-share-edge:var(--club-line-strong,rgba(180,190,200,.32));--club-share-line:var(--club-line,rgba(180,190,200,.16));
        --club-share-accent:var(--club-accent,#3ad4e6);--club-share-soft:var(--club-accent-soft,rgba(58,212,230,.12));
        --club-share-float:var(--club-material-float,rgba(24,27,31,.94));
        --club-share-shadow:var(--club-material-shadow,0 16px 48px rgba(0,0,0,.32));
        font-family:var(--club-font,"Inter Variable","MiSans VF","MiSans","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",system-ui,sans-serif);color:var(--club-share-text);color-scheme:dark;
      }
      html[data-theme="light"] :is(.club-share-layer,.club-share-toast){
        --club-share-panel:var(--club-metal-panel,#f1eee8);
        --club-share-read:var(--club-material-read,var(--club-surface,#fffdfa));
        --club-share-control:var(--club-material-control,#f7f4ee);--club-share-hover:var(--club-material-hover,#fffdf8);
        --club-share-control-finish:var(--club-metal-control-finish,linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,.08) 52%,rgba(108,93,74,.05)));
        --club-share-control-rim:rgba(255,255,255,.92);
        --club-share-text:var(--club-text,#17181c);--club-share-muted:var(--club-muted,#5b6069);
        --club-share-edge:var(--club-line-strong,#cdd2db);--club-share-line:var(--club-line,#e2e5eb);
        --club-share-accent:var(--club-accent,#c2410c);--club-share-soft:var(--club-accent-soft,#fdf0ea);
        --club-share-float:var(--club-material-float,rgba(255,255,255,.96));
        --club-share-shadow:var(--club-material-shadow,0 16px 48px rgba(23,24,28,.12));color-scheme:light;
      }
      .club-share-layer{position:fixed;inset:0;z-index:1200;display:none;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:var(--club-material-scrim,rgba(8,10,12,.64));-webkit-backdrop-filter:none;backdrop-filter:none}
      html[data-theme="light"] .club-share-layer{background:var(--club-material-scrim,rgba(32,38,48,.28))}
      .club-share-layer.is-open{display:flex}
      .club-share-layer .club-share-card{box-sizing:border-box;width:min(440px,100%);max-width:100%;max-height:calc(100vh - 48px);max-height:calc(100dvh - 48px);overflow:auto;padding:28px;border:1px solid var(--club-share-edge);border-radius:var(--club-radius,14px);background:var(--club-share-panel);color:var(--club-share-text);box-shadow:var(--club-share-shadow);scrollbar-width:thin;scrollbar-color:var(--club-share-edge) var(--club-share-panel)}
      .club-share-card h2{margin:0 0 8px;color:var(--club-share-text);font-size:21px;font-weight:740;line-height:1.3;text-wrap:balance;overflow-wrap:anywhere}
      .club-share-card p{margin:0 0 24px;font-size:14px;line-height:1.7;color:var(--club-share-muted);overflow-wrap:anywhere}
      .club-share-card .club-share-options{display:grid;gap:0;border-block:1px solid var(--club-share-edge);background:var(--club-share-read)}
      .club-share-card .club-share-option{box-sizing:border-box;display:flex;align-items:center;gap:14px;width:100%;min-height:64px;margin:0;padding:16px 12px;border:0;border-bottom:1px solid var(--club-share-line);border-radius:0;background-color:transparent;color:var(--club-share-text);font:inherit;font-size:14px;font-weight:600;text-align:left;line-height:1.5;cursor:pointer;transition:background-color .14s ease,color .14s ease,transform .14s ease}
      .club-share-card .club-share-option:last-child{border-bottom:0}
      .club-share-card .club-share-option:hover{background-color:var(--club-share-hover);color:var(--club-share-accent)}
      .club-share-card .club-share-option svg{box-sizing:content-box;width:22px;height:22px;flex:0 0 auto;padding:9px;border:1px solid var(--club-share-edge);border-radius:var(--club-radius-sm,9px);background-color:var(--club-share-control);background-image:var(--club-share-control-finish);box-shadow:inset 0 1px 0 var(--club-share-control-rim);color:var(--club-share-accent)}
      .club-share-card .club-share-option span{min-width:0;overflow-wrap:anywhere}
      .club-share-card .club-share-option small{display:block;margin-top:3px;font-size:12px;font-weight:400;line-height:1.6;color:var(--club-share-muted)}
      .club-share-card .club-share-cancel{box-sizing:border-box;display:block;width:100%;min-height:40px;margin:20px 0 0;padding:9px 14px;border:1px solid var(--club-share-edge);border-radius:var(--club-radius-sm,9px);background-color:var(--club-share-control);box-shadow:inset 0 1px 0 var(--club-share-control-rim),0 2px 3px rgba(0,7,18,.08);color:var(--club-share-text);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background-color .14s ease,border-color .14s ease,transform .14s ease}
      .club-share-card .club-share-cancel:hover{border-color:var(--club-share-accent);background-color:var(--club-share-hover)}
      .club-share-card :is(.club-share-option,.club-share-cancel):focus-visible{outline:2px solid var(--club-share-accent);outline-offset:3px}
      .club-share-card :is(.club-share-option,.club-share-cancel):active{transform:translateY(1px)}
      .club-share-card button:disabled{opacity:.5;cursor:not-allowed;transform:none}
      .club-share-toast{box-sizing:border-box;position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:1300;width:max-content;max-width:calc(100vw - 32px);padding:14px 18px;border:1px solid var(--club-share-edge);border-radius:12px;background:var(--club-share-panel);box-shadow:var(--club-share-shadow);font-size:13px;line-height:1.6;text-align:center;overflow-wrap:anywhere;opacity:0;transform:translate(-50%,8px);pointer-events:none;transition:opacity .2s ease,transform .2s cubic-bezier(.22,1,.36,1)}
      .club-share-toast.is-visible{opacity:1;transform:translate(-50%,0)}
      /* Material stays behind content; the standalone lighting owner supplies px coordinates. */
      .club-share-layer .club-share-card,.club-share-toast{
        --club-pointer-active:0;
        --club-share-glass-fill:var(--club-liquid-fallback,#162231);
        --club-share-glass-tint:var(--club-liquid-glass,rgba(18,29,44,.78));
        --club-share-light-rgb:190,226,255;
        --club-share-gloss:var(--club-liquid-wash,linear-gradient(155deg,rgba(211,235,255,.12),rgba(211,235,255,0) 42%,rgba(58,212,230,.025)));
        --club-share-rim:var(--club-liquid-rim,rgba(224,243,255,.27));
        --club-share-rim-low:var(--club-liquid-rim-low,rgba(8,17,29,.52));
        border-color:var(--club-liquid-line,rgba(151,192,218,.28));border-radius:20px;
        background-color:var(--club-share-glass-fill);
        background-image:radial-gradient(240px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-share-light-rgb),calc(var(--club-pointer-active,0)*.075)),transparent 72%),var(--club-share-gloss);
        box-shadow:inset 0 1px 0 var(--club-share-rim),inset 0 -1px 0 var(--club-share-rim-low),var(--club-share-shadow);
      }
      html[data-theme="light"] :is(.club-share-card,.club-share-toast){
        --club-share-glass-fill:var(--club-liquid-fallback,#faf7f2);
        --club-share-glass-tint:var(--club-liquid-glass,rgba(255,252,247,.88));
        --club-share-light-rgb:194,133,76;
        --club-share-gloss:var(--club-liquid-wash,linear-gradient(155deg,rgba(255,255,255,.8),rgba(255,255,255,0) 44%,rgba(194,133,76,.035)));
        --club-share-rim:var(--club-liquid-rim,rgba(255,255,255,.9));
        --club-share-rim-low:var(--club-liquid-rim-low,rgba(108,93,74,.12));
        border-color:var(--club-liquid-line,rgba(108,93,74,.24));
      }
      @supports (backdrop-filter:blur(12px)) or (-webkit-backdrop-filter:blur(12px)){
        .club-share-layer .club-share-card,.club-share-toast{background-color:var(--club-share-glass-tint);-webkit-backdrop-filter:blur(12px) saturate(1.2);backdrop-filter:blur(12px) saturate(1.2)}
        .club-share-layer .club-share-card{-webkit-backdrop-filter:blur(16px) saturate(1.2);backdrop-filter:blur(16px) saturate(1.2)}
      }
      .club-share-card :is(.club-share-option,.club-share-cancel){
        --club-pointer-active:0;
        -webkit-backdrop-filter:none;backdrop-filter:none;
        background-image:radial-gradient(120px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-share-light-rgb),calc(var(--club-pointer-active,0)*.04)),transparent 72%),var(--club-share-control-finish);
      }
      .club-share-card :is(input,select,textarea,pre,code){background:var(--club-share-read);-webkit-backdrop-filter:none;backdrop-filter:none}
      @media(prefers-reduced-transparency:reduce){
        .club-share-layer .club-share-card,.club-share-toast{background:var(--club-share-glass-fill)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
        .club-share-card :is(.club-share-option,.club-share-cancel){background-image:none!important}
      }
      @media(prefers-reduced-motion:reduce){.club-share-layer .club-share-card,.club-share-toast,.club-share-card :is(.club-share-option,.club-share-cancel){background-image:none!important}}
      @media(forced-colors:active){
        .club-share-layer,.club-share-layer .club-share-card,.club-share-toast{background:Canvas!important;color:CanvasText!important;border-color:CanvasText!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
        .club-share-card :is(h2,p,small){color:CanvasText!important}
        .club-share-card :is(.club-share-option,.club-share-cancel){background:ButtonFace!important;color:ButtonText!important;border-color:ButtonText!important;box-shadow:none!important}
        .club-share-card .club-share-option svg{background:ButtonFace!important;border-color:ButtonText!important;box-shadow:none!important;color:ButtonText!important}
        .club-share-card :is(.club-share-option,.club-share-cancel):focus-visible{outline-color:Highlight!important}
      }
      .club-share-layer ::selection,.club-share-toast::selection{background:var(--club-share-soft);color:var(--club-share-text)}
      @media(max-width:640px){.club-share-layer{padding:16px}.club-share-layer .club-share-card{padding:24px 20px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px)}}
      @media(pointer:coarse){.club-share-card .club-share-cancel{min-height:44px}}
      @media(prefers-reduced-motion:reduce){.club-share-layer,.club-share-layer *,.club-share-toast{animation:none!important;transition:none!important;scroll-behavior:auto!important}.club-share-card :is(.club-share-option,.club-share-cancel):active{transform:none}.club-share-toast,.club-share-toast.is-visible{transform:translate(-50%,0)}}
      @media print{.club-share-layer,.club-share-toast{display:none!important}}
    `;
    (document.head || document.documentElement || document.body).appendChild(style);
  }

  function t(key, fallback) {
    try {
      if (global.ClubI18n && typeof global.ClubI18n.t === 'function') {
        var value = global.ClubI18n.t(key);
        if (value && value !== key) return value;
      }
    } catch (_error) { /* ignore */ }
    return fallback;
  }

  // 判定「移动/平板」而不是「有没有触摸屏」：
  // 带触摸屏的 Windows 笔记本 maxTouchPoints 也 > 1，但它是桌面端，
  // 应该弹我们自己的分享面板，而不是直接调系统分享。
  function isMobileLike() {
    try {
      var ua = navigator.userAgent || '';
      if (/iPad|iPhone|iPod|Android|Mobile|HarmonyOS/i.test(ua)) return true;
      // iPadOS 13+ 默认伪装成桌面 Safari。
      if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) return true;
      return false;
    } catch (_error) { return false; }
  }

  // 兼容旧调用名。
  function isTouchDevice() { return isMobileLike(); }

  function canNativeShare(payload) {
    try {
      return typeof navigator.share === 'function' &&
        (!navigator.canShare || navigator.canShare(payload));
    } catch (_error) { return false; }
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(area);
      return Boolean(ok);
    } catch (_error) { return false; }
  }

  function toast(message) {
    injectStyle();
    var id = 'club-share-toast';
    var node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.className = 'club-share-toast';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(node._timer);
    node._timer = setTimeout(function () { node.classList.remove('is-visible'); }, 2600);
  }

  function share(payload) {
    var data = payload || {};
    var url = data.url || location.href;
    var title = data.title || document.title;
    var text = data.text || title;
    var sharePayload = { title: title, text: text, url: url };

    if (canNativeShare(sharePayload)) {
      return navigator.share(sharePayload)
        .then(function () { return 'shared'; })
        .catch(function (error) {
          // 用户主动取消不算失败。
          return error && error.name === 'AbortError' ? 'cancelled' : 'failed';
        });
    }

    // 没有系统分享面板：复制链接并提示，这是桌面端唯一可靠的路径。
    return copy(url).then(function (ok) {
      if (!ok) return 'failed';
      toast(isTouchDevice()
        ? t('share.copiedMobile', '链接已复制，打开微信或 QQ 粘贴发送即可。')
        : t('share.copiedDesktop', '链接已复制，粘贴到微信或 QQ 聊天窗口即可发送。'));
      return 'copied';
    });
  }

  // 唤起客户端。桌面端 weixin:// 只能打开微信本身，无法预填链接，
  // 所以这里同时复制链接，让用户直接粘贴。
  function openWeChat(url) {
    var link = url || location.href;
    return copy(link).then(function () {
      toast(t('share.wechatHint', '链接已复制，打开微信粘贴发送即可。'));
      try {
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) location.href = 'weixin://';
        else location.href = 'weixin://';
      } catch (_error) { /* 客户端未安装时忽略 */ }
      return 'opened';
    });
  }

  function openQQ(url) {
    var link = url || location.href;
    return copy(link).then(function () {
      toast(t('share.qqHint', '链接已复制，打开 QQ 粘贴发送即可。'));
      try {
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) location.href = 'mqq://';
        else location.href = 'mqq://';
      } catch (_error) { /* ignore */ }
      return 'opened';
    });
  }

  // ---- 分享面板 -----------------------------------------------------------
  var panel = null;
  var panelOpener = null;

  var ICONS = {
    native: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>',
    wechat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4a6 6 0 0 0 0 12 6.6 6.6 0 0 0 2-.3l3 1.6-.7-2.6A6 6 0 0 0 9 4z"/><path d="M16.5 9.5a4.5 4.5 0 0 1 0 9 5 5 0 0 1-1.6-.26l-2.3 1.2.55-2A4.5 4.5 0 0 1 16.5 9.5z"/></svg>',
    qq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c3 0 5 2.2 5 5v2c0 3.4 1.5 4.6 1.5 6.4 0 1-.7 1.6-1.8 1.6-.8 0-1.4-.4-2-.9-.7.6-1.7 1-2.7 1s-2-.4-2.7-1c-.6.5-1.2.9-2 .9-1.1 0-1.8-.6-1.8-1.6C5.5 14.6 7 13.4 7 10V8c0-2.8 2-5 5-5z"/><path d="M9.5 8.5h.01M14.5 8.5h.01"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>'
  };

  function optionHtml(id, icon, label, hint) {
    return '<button type="button" class="club-share-option" data-share-option="' + id + '">' +
      ICONS[icon] +
      '<span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span>' +
      '</button>';
  }

  function buildPanel() {
    injectStyle();
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'club-share-layer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    var options = '';
    if (typeof navigator.share === 'function') {
      options += optionHtml('native', 'native',
        t('share.native', '系统分享'),
        t('share.nativeHint', '选择微信、QQ 或其他应用'));
    }
    options += optionHtml('wechat', 'wechat', t('share.wechat', '微信'), t('share.wechatHintShort', '复制链接后打开微信粘贴'));
    options += optionHtml('qq', 'qq', t('share.qq', 'QQ'), t('share.qqHintShort', '复制链接后打开 QQ 粘贴'));
    options += optionHtml('copy', 'copy', t('share.copy', '复制链接'), t('share.copyHint', '手动粘贴到任意聊天窗口'));

    panel.innerHTML =
      '<div class="club-share-card" role="document">' +
      '<h2>' + t('share.title', '分享算法社') + '</h2>' +
      '<p>' + t('share.lead', '把算法社推荐给同学，或分享到群聊。') + '</p>' +
      '<div class="club-share-options">' + options + '</div>' +
      '<button type="button" class="club-share-cancel" data-share-cancel>' + t('share.cancel', '取消') + '</button>' +
      '</div>';
    document.body.appendChild(panel);

    panel.addEventListener('click', function (event) {
      if (event.target === panel) closePanel();
      var cancel = event.target.closest('[data-share-cancel]');
      if (cancel) { closePanel(); return; }
      var option = event.target.closest('[data-share-option]');
      if (!option) return;
      var id = option.getAttribute('data-share-option');
      var url = panel._url || location.href;
      closePanel();
      if (id === 'native') share({ url: url });
      else if (id === 'wechat') openWeChat(url);
      else if (id === 'qq') openQQ(url);
      else copy(url).then(function (ok) {
        toast(ok ? t('share.copied', '链接已复制。') : t('share.copyFailed', '复制失败，请手动复制地址栏。'));
      });
    });

    document.addEventListener('keydown', onPanelKeydown);
    return panel;
  }

  function onPanelKeydown(event) {
    if (!panel || !panel.classList.contains('is-open')) return;
    if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
    if (event.key !== 'Tab' || typeof panel.querySelectorAll !== 'function') return;
    var focusables = Array.prototype.filter.call(panel.querySelectorAll('button'), function (button) {
      return !button.disabled && !button.hidden;
    });
    if (!focusables.length) return;
    var index = focusables.indexOf(document.activeElement);
    var next = event.shiftKey
      ? (index <= 0 ? focusables.length - 1 : index - 1)
      : (index < 0 || index >= focusables.length - 1 ? 0 : index + 1);
    event.preventDefault();
    if (typeof focusables[next].focus === 'function') focusables[next].focus();
  }

  function openPanel(url) {
    var node = buildPanel();
    if (!node.classList.contains('is-open')) panelOpener = document.activeElement;
    node._url = url || location.href;
    node.classList.add('is-open');
    var first = node.querySelector('.club-share-option');
    if (first && typeof first.focus === 'function') first.focus();
  }

  function closePanel() {
    if (!panel || !panel.classList.contains('is-open')) return;
    panel.classList.remove('is-open');
    var opener = panelOpener;
    panelOpener = null;
    var connected = opener && (typeof opener.isConnected === 'boolean'
      ? opener.isConnected
      : (document.documentElement && typeof document.documentElement.contains === 'function'
        ? document.documentElement.contains(opener) : false));
    try { if (connected && typeof opener.focus === 'function') opener.focus(); } catch (_error) { /* removed or unavailable opener */ }
  }

  function bind() {
    document.querySelectorAll('[data-share-trigger]').forEach(function (button) {
      if (button.dataset.shareBound) return;
      button.dataset.shareBound = '1';
      button.addEventListener('click', function () {
        // 手机上优先直接用系统分享面板，少一步点击。
        if (isMobileLike() && typeof navigator.share === 'function') {
          share({ url: location.href });
          return;
        }
        openPanel(location.href);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    setTimeout(bind, 0);
  }
  // 语言切换后重建面板文案。
  window.addEventListener('club:langchange', function () {
    if (panel) {
      closePanel();
      document.removeEventListener('keydown', onPanelKeydown);
      panel.remove();
      panel = null;
    }
  });

  global.ClubShare = {
    share: share,
    openWeChat: openWeChat,
    openQQ: openQQ,
    copy: copy,
    toast: toast,
    isTouchDevice: isTouchDevice
  };

  global.ClubShare.openPanel = openPanel;
  global.ClubShare.closePanel = closePanel;
})();
