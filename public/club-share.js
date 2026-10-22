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

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && panel.classList.contains('is-open')) closePanel();
    });
    return panel;
  }

  function openPanel(url) {
    var node = buildPanel();
    node._url = url || location.href;
    node.classList.add('is-open');
    var first = node.querySelector('.club-share-option');
    if (first) first.focus();
  }

  function closePanel() {
    if (panel) panel.classList.remove('is-open');
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
    if (panel) { panel.remove(); panel = null; }
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
