/**
 * 全站共享前端基础层。
 * 自包含（样式运行时注入），不依赖 club-ui.css，因此 chat / assistant /
 * platformer 这类独立页面也能使用。
 *
 * 提供：escapeHtml、统一确认对话框、5 秒可撤销删除、列表三态、401 会话提示。
 * 加载方式：普通 <script>，需位于各页内联脚本与 chat.js 之前。
 */
(function (global) {
  'use strict';

  if (global.ClubCommon) return;

  var STYLE_ID = 'club-common-style';
  var DIALOG_CLASS = 'club-common-dialog-layer';
  var UNDO_HOST_ID = 'club-common-undo-host';

  function t(key, vars) {
    try {
      if (global.ClubI18n && typeof global.ClubI18n.t === 'function') return global.ClubI18n.t(key, vars);
    } catch (_error) { /* ignore */ }
    return key;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      /* 对话框 */
      '.club-common-dialog-layer{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(3,6,12,.62);backdrop-filter:blur(4px)}',
      '.club-common-dialog{width:min(460px,100%);max-height:min(80vh,640px);overflow:auto;padding:22px 22px 18px;border:1px solid var(--club-line,#2a3a4f);border-radius:14px;background:var(--club-surface,#0e1524);color:var(--club-text,#e8eef7);box-shadow:0 24px 64px rgba(0,0,0,.45)}',
      '.club-common-dialog h2{margin:0 0 10px;font-size:18px;line-height:1.35;color:var(--club-text,#e8eef7)}',
      '.club-common-dialog p{margin:0 0 20px;color:var(--club-muted,#9db0c6);font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.club-common-dialog-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}',
      '.club-common-dialog-actions button{min-height:40px;padding:8px 16px;border-radius:8px;border:1px solid var(--club-line-strong,#31465f);background:var(--club-surface-2,#162235);color:var(--club-text,#e8eef7);font:inherit;font-size:13px;font-weight:650;cursor:pointer}',
      '.club-common-dialog-actions button:hover{filter:brightness(1.1)}',
      '.club-common-dialog-actions button.club-common-danger{border-color:color-mix(in srgb,var(--club-danger,#f0707f) 55%,transparent);background:var(--club-danger-soft,#3a1a20);color:var(--club-danger,#f0707f)}',
      '.club-common-dialog-actions button:focus-visible{outline:2px solid var(--club-accent,#4fd1e8);outline-offset:2px}',
      /* 撤销提示 */
      '#club-common-undo-host{position:fixed;right:18px;bottom:18px;z-index:10050;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 36px));pointer-events:none}',
      '.club-common-undo{pointer-events:auto;display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--club-line-strong,#31465f);border-radius:12px;background:var(--club-surface,#0e1524);color:var(--club-text,#e8eef7);box-shadow:0 16px 40px rgba(0,0,0,.4);font-size:13.5px;overflow:hidden;position:relative}',
      '.club-common-undo-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}',
      '.club-common-undo button{flex:0 0 auto;min-height:34px;padding:6px 12px;border-radius:8px;border:1px solid var(--club-accent-line,#2c6b78);background:var(--club-accent-soft,#0f2f38);color:var(--club-accent,#4fd1e8);font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
      '.club-common-undo-bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--club-accent,#4fd1e8);transform-origin:left center;animation:club-common-countdown linear forwards}',
      '@keyframes club-common-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}',
      /* 列表三态 */
      '.club-common-state{padding:26px 18px;text-align:center;color:var(--club-muted,#9db0c6);font-size:13.5px;line-height:1.7}',
      '.club-common-state strong{display:block;margin-bottom:6px;color:var(--club-text,#e8eef7);font-size:14.5px}',
      '.club-common-state.club-common-error strong{color:var(--club-danger,#f0707f)}',
      '.club-common-state button{margin-top:12px}',
      '.club-common-skeleton{display:grid;gap:10px;padding:16px 18px}',
      '.club-common-skeleton span{display:block;height:14px;border-radius:6px;background:linear-gradient(90deg,var(--club-surface-2,#162235) 25%,var(--club-line,#2a3a4f) 37%,var(--club-surface-2,#162235) 63%);background-size:400% 100%;animation:club-common-shimmer 1.4s ease infinite}',
      '.club-common-skeleton span:nth-child(2){width:82%}',
      '.club-common-skeleton span:nth-child(3){width:64%}',
      '@keyframes club-common-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}',
      /* 会话过期提示条 */
      '.club-common-session{position:fixed;top:0;left:0;right:0;z-index:10060;display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;padding:10px 16px;background:#7a2d1c;color:#ffe9df;font-size:13.5px;line-height:1.5;box-shadow:0 6px 20px rgba(0,0,0,.35)}',
      '.club-common-session a{color:#ffd7c8;font-weight:700;text-decoration:underline}',
      '.club-common-session button{margin-left:auto;min-height:30px;padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.35);background:transparent;color:inherit;font:inherit;cursor:pointer}',
      /* 亮色主题 */
      'html[data-theme="light"] .club-common-dialog{background:#fffaf6;color:#332a28;border-color:#e2c9bc}',
      'html[data-theme="light"] .club-common-dialog h2{color:#332a28}',
      'html[data-theme="light"] .club-common-dialog p{color:#6b5a53}',
      'html[data-theme="light"] .club-common-dialog-actions button{background:#fff;border-color:#d9b9ab;color:#5d3a2c}',
      'html[data-theme="light"] .club-common-dialog-actions button.club-common-danger{background:#fde8e4;border-color:#d98674;color:#a33824}',
      'html[data-theme="light"] .club-common-undo{background:#fffaf6;border-color:#e2c9bc;color:#3a2f2b}',
      'html[data-theme="light"] .club-common-undo button{background:#e8f6f8;border-color:#9fc6cd;color:#0f6572}',
      'html[data-theme="light"] .club-common-state{color:#6b5a53}',
      'html[data-theme="light"] .club-common-state strong{color:#332a28}',
      'html[data-theme="light"] .club-common-skeleton span{background:linear-gradient(90deg,#f3e6df 25%,#e6d2c8 37%,#f3e6df 63%);background-size:400% 100%}',
      'html[data-theme="light"] .club-common-session{background:#9a3a24;color:#fff4ee}',
      /* 手机 */
      '@media (max-width:560px){.club-common-dialog-layer{padding:14px}.club-common-dialog{padding:18px 16px 14px;border-radius:12px}.club-common-dialog-actions button{flex:1 1 auto}#club-common-undo-host{left:12px;right:12px;bottom:12px;max-width:none}.club-common-undo{padding:11px 12px}}',
      /* 打印：浮层不进入纸张 */
      '@media print{.club-common-dialog-layer,#club-common-undo-host,.club-common-session{display:none!important}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /* ---------- 统一确认对话框 ---------- */
  var activeDialog = null;

  function confirm(options) {
    var opts = options || {};
    if (typeof opts === 'string') opts = { message: opts };
    injectStyle();
    return new Promise(function (resolve) {
      // 同一时间只保留一个确认框；新请求会先取消旧的。
      if (activeDialog) activeDialog.dismiss(false);

      var previousFocus = document.activeElement;
      var layer = document.createElement('div');
      layer.className = DIALOG_CLASS;

      var dialog = document.createElement('div');
      dialog.className = 'club-common-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      var titleId = 'club-common-dialog-title-' + Math.random().toString(36).slice(2, 8);
      if (opts.title) {
        var heading = document.createElement('h2');
        heading.id = titleId;
        heading.textContent = opts.title;
        dialog.setAttribute('aria-labelledby', titleId);
        dialog.appendChild(heading);
      }

      var body = document.createElement('p');
      body.textContent = opts.message == null ? '' : String(opts.message);
      dialog.appendChild(body);

      var actions = document.createElement('div');
      actions.className = 'club-common-dialog-actions';
      var cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = opts.cancelText || t('common.cancel');
      var confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.textContent = opts.confirmText || t('common.confirm');
      if (opts.danger) confirmButton.className = 'club-common-danger';
      actions.append(cancelButton, confirmButton);
      dialog.appendChild(actions);
      layer.appendChild(dialog);

      var settled = false;
      function dismiss(result) {
        if (settled) return;
        settled = true;
        if (activeDialog && activeDialog.layer === layer) activeDialog = null;
        document.removeEventListener('keydown', onKeydown, true);
        // remove() 在部分旧环境不存在；回退到父节点移除，保证对话框真的消失。
        if (typeof layer.remove === 'function') layer.remove();
        else if (layer.parentNode) layer.parentNode.removeChild(layer);
        try { if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus(); } catch (_error) { /* ignore */ }
        resolve(result);
      }
      function onKeydown(event) {
        if (event.key === 'Escape') { event.preventDefault(); dismiss(false); return; }
        if (event.key !== 'Tab') return;
        // 把焦点圈在对话框的两个按钮内。
        var focusables = [cancelButton, confirmButton].filter(function (node) { return !node.disabled; });
        if (!focusables.length) return;
        var index = focusables.indexOf(document.activeElement);
        event.preventDefault();
        var next = event.shiftKey ? (index <= 0 ? focusables.length - 1 : index - 1) : (index >= focusables.length - 1 ? 0 : index + 1);
        focusables[next].focus();
      }

      activeDialog = { layer: layer, dismiss: dismiss };
      cancelButton.addEventListener('click', function () { dismiss(false); });
      confirmButton.addEventListener('click', function () { dismiss(true); });
      layer.addEventListener('mousedown', function (event) { if (event.target === layer) dismiss(false); });
      document.addEventListener('keydown', onKeydown, true);
      document.body.appendChild(layer);
      // 破坏性操作默认聚焦“取消”，避免误触回车直接删除。
      (opts.danger ? cancelButton : confirmButton).focus();
    });
  }

  /* ---------- 5 秒可撤销删除 ---------- */
  var undoHost = null;
  var pendingCommits = new Set();

  function ensureUndoHost() {
    if (undoHost && undoHost.isConnected) return undoHost;
    undoHost = document.getElementById(UNDO_HOST_ID);
    if (!undoHost) {
      undoHost = document.createElement('div');
      undoHost.id = UNDO_HOST_ID;
      undoHost.setAttribute('role', 'region');
      undoHost.setAttribute('aria-label', t('common.undoRegion'));
      (document.body || document.documentElement).appendChild(undoHost);
    }
    return undoHost;
  }

  function scheduleUndo(options) {
    var opts = options || {};
    var seconds = Number(opts.seconds) > 0 ? Number(opts.seconds) : 5;
    injectStyle();
    var host = ensureUndoHost();

    var item = document.createElement('div');
    item.className = 'club-common-undo';
    var text = document.createElement('span');
    text.className = 'club-common-undo-text';
    text.textContent = opts.message || t('common.pendingDelete');
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = opts.undoLabel || t('common.undo');
    var bar = document.createElement('span');
    bar.className = 'club-common-undo-bar';
    bar.style.animationDuration = seconds + 's';
    item.append(text, button, bar);
    host.appendChild(item);

    var done = false;
    var timer = null;
    var entry = { flush: flush };
    pendingCommits.add(entry);

    function removeItem() {
      pendingCommits.delete(entry);
      window.removeEventListener('pagehide', onPageHide);
      item.remove();
    }
    function finish(commitNow) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // 先执行回调再移除节点：撤销回调可能需要把行插回列表。
      if (commitNow) {
        try {
          var result = opts.commit && opts.commit({ pagehide: false });
          if (result && typeof result.catch === 'function') result.catch(function () { /* 由调用方提示 */ });
        } catch (_error) { /* ignore */ }
      } else {
        try { var undo = opts.onUndo || opts.undo; if (undo) undo(); } catch (_error) { /* ignore */ }
      }
      removeItem();
    }
    function flush() {
      // 页面即将关闭：立即提交，调用方的 commit 应使用 keepalive fetch。
      if (done) return;
      done = true;
      clearTimeout(timer);
      removeItem();
      try { if (opts.commit) opts.commit({ pagehide: true }); } catch (_error) { /* ignore */ }
    }
    function onPageHide() { flush(); }

    button.addEventListener('click', function () { finish(false); });
    window.addEventListener('pagehide', onPageHide, { once: true });
    timer = setTimeout(function () { finish(true); }, seconds * 1000);

    return {
      cancel: function () { finish(false); },
      flush: function () { finish(true); },
      element: item
    };
  }

  /* ---------- 列表三态 ---------- */
  function listStateHtml(kind, options) {
    var opts = options || {};
    var message = opts.message == null ? '' : String(opts.message);
    if (kind === 'loading') {
      return '<div class="club-common-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>' +
        '<span class="club-common-state" role="status">' + escapeHtml(message || t('common.loading')) + '</span>';
    }
    if (kind === 'error') {
      return '<div class="club-common-state club-common-error" role="alert"><strong>' +
        escapeHtml(opts.title || t('common.loadFailed')) + '</strong>' +
        escapeHtml(message || t('common.loadRetry')) + '</div>';
    }
    return '<div class="club-common-state club-common-empty" role="status"><strong>' +
      escapeHtml(opts.title || t('common.empty')) + '</strong>' +
      (message ? escapeHtml(message) : '') + '</div>';
  }

  function listState(container, options) {
    if (!container) return;
    var opts = options || {};
    container.innerHTML = listStateHtml(opts.kind || 'loading', opts);
    if (opts.kind === 'loading') container.setAttribute('aria-busy', 'true');
    else container.removeAttribute('aria-busy');
    if (opts.kind === 'error' && typeof opts.onRetry === 'function') {
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'button secondary';
      retry.textContent = opts.retryLabel || t('common.retry');
      retry.addEventListener('click', opts.onRetry);
      var state = container.querySelector('.club-common-state');
      if (state) state.appendChild(retry);
    }
    return container;
  }

  /* ---------- 401 会话过期 ---------- */
  var sessionBanner = null;

  function memberCenterHref() {
    var path = String(location.pathname || '');
    return path.indexOf('/public/') >= 0 ? 'member-center.html' : 'public/member-center.html';
  }

  function showSessionBanner() {
    if (sessionBanner && sessionBanner.isConnected) return;
    injectStyle();
    sessionBanner = document.createElement('div');
    sessionBanner.className = 'club-common-session';
    sessionBanner.setAttribute('role', 'alert');
    var text = document.createElement('span');
    text.textContent = t('common.sessionExpired');
    var link = document.createElement('a');
    link.href = memberCenterHref();
    link.textContent = t('common.sessionExpiredAction');
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = t('common.dismiss');
    close.addEventListener('click', function () { sessionBanner.remove(); sessionBanner = null; });
    sessionBanner.append(text, link, close);
    (document.body || document.documentElement).appendChild(sessionBanner);
  }

  function handleAuthError(response, payload, fallbackMessage) {
    if (response && response.status === 401) {
      try { window.dispatchEvent(new CustomEvent('club:session-expired')); } catch (_error) { /* ignore */ }
      var expired = new Error(t('common.sessionExpired'));
      expired.status = 401;
      expired.code = 'session_expired';
      return expired;
    }
    var message = payload && typeof payload === 'object' && payload.error ? payload.error : (fallbackMessage || t('common.requestFailed'));
    var error = new Error(String(message));
    if (response && response.status) error.status = response.status;
    return error;
  }

  window.addEventListener('club:session-expired', showSessionBanner);

  global.ClubCommon = {
    t: t,
    escapeHtml: escapeHtml,
    confirm: confirm,
    scheduleUndo: scheduleUndo,
    listState: listState,
    listStateHtml: listStateHtml,
    handleAuthError: handleAuthError,
    showSessionBanner: showSessionBanner,
    ready: ready
  };

  // 页面关闭前把仍待提交的删除立刻发出；调用方的 commit 应使用 keepalive。
  window.addEventListener('pagehide', function () {
    pendingCommits.forEach(function (entry) { try { entry.flush(); } catch (_error) { /* ignore */ } });
  });
})(window);
