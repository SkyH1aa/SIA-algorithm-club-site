/* Shared liquid material lighting; no shell or business-logic dependency. */
(function (global) {
  'use strict';
  if (global.ClubLiquidLighting) return;

  /* ------------------------------------------------------------
     液态材质的局部指针光：静态标记与增强分离，不接管点击或业务 API。
     CSS 合同：club-liquid-surface / club-liquid-control；坐标为元素内 px，
     --club-pointer-active 为 0/1。只有精确悬停指针且无减少偏好才跟踪。
     ------------------------------------------------------------ */
  function createClubLiquidLighting() {
    var surfaces = '.card, .resource-card, .quick-link, .lab-entry, .premium-entry, .premium-feature, .premium-resource, .premium-guide, .premium-steps, .club-auth-shell, .hero-copy, .orbit-matrix, .planet-row, .member-card, .project-grid, .timeline, .join-card, body.club-page .panel, body.legacy-premium .panel, body.legacy-premium .legacy-topbar, body.premium-error .topbar, body.premium-error .premium-error-layout, .chat-page .chat-topbar, .chat-page .chat-sidebar, .chat-page .chat-gate-card, .chat-page .chat-suggestion, .chat-page .chat-composer-box, .chat-page .chat-settings-panel, body.chat-admin-page .chat-admin-header, body.chat-admin-page .chat-admin-tabs, body.chat-admin-page .chat-admin-status-card, body.chat-admin-page .chat-admin-stat, body.chat-admin-page .chat-admin-gate, #club-assistant .club-assistant-head, .shell > header, .shell .auth-gate, .shell .password-panel, .shell .pk-panel, .shell .leaderboard-panel, .shell .game-admin-panel, .shell .touch-controls, .shell .game-announcement-card, .club-common-dialog, .club-common-undo, .club-common-toast, .club-share-card, .club-share-toast, #club-service-live-pill, #club-service-overlay .service-modal-box';
    var controls = '.btn, a.button, button.button, .primary-action, .secondary-action, .club-btn, .cap-controls button, button.share-action, a.share-action, button.chip, a.chip, button.club-launcher-button, button.club-launcher-clear, button.club-notify-button, button.club-to-top, .chat-page .chat-new-button, .chat-page .chat-back, .chat-page .chat-icon-button, .chat-page .chat-lang-button, .chat-page .chat-model-picker, .chat-page .chat-send-button, .chat-page .chat-stop-button, .chat-page .chat-effort-trigger, #club-assistant .club-assistant-ball, body.chat-admin-page .chat-admin-button, body.chat-admin-page .chat-admin-tabs button, body.legacy-premium .controls button, body.legacy-premium .info-panel button, body.legacy-premium .legacy-theme button, body.premium-error .actions .button, .shell .button, .shell header a, .club-common-dialog-actions button, .club-common-undo button, .club-share-card .club-share-option, .club-share-card .club-share-cancel, #club-service-overlay .service-tools button, #club-service-overlay .service-tools a, #club-service-overlay .service-close';
    var excluded = '.board, canvas, svg, table, pre, .release-card, .chat-model-menu, .club-assistant-frame';
    var plainSurfaces = '.auth-view, .club-auth-gate, .premium-head, .premium-section-head, .section-heading, form, table, pre, #club-assistant, .club-assistant-panel, .club-assistant-frame';
    var marked = '.club-liquid-surface, .club-liquid-control';
    var media = [];
    var bound = false;
    var suspended = false;
    var tracking = false;
    var watcher = null;
    var active = null;
    var pending = null;
    var frame = null;
    var passive = { passive: true };

    function closest(node, selector) {
      return node && typeof node.closest === 'function' ? node.closest(selector) : null;
    }

    function setClass(node, name, enabled) {
      if (node.classList.contains(name) === enabled) return;
      if (enabled) node.classList.add(name);
      else node.classList.remove(name);
    }

    function surfaceCandidate(node) {
      return node && node.matches && node.matches(surfaces) && !node.matches(plainSurfaces) && !closest(node, excluded);
    }

    function markOne(node) {
      if (!node || node.nodeType !== 1 || typeof node.matches !== 'function' || !node.classList) return;
      var allowed = !closest(node, excluded);
      var control = allowed && node.matches(controls);
      // 以真实候选祖先判断，插入/移动整棵已标记子树时也不会产生双层玻璃。
      var surface = allowed && !control && surfaceCandidate(node);
      for (var parent = node.parentElement; surface && parent; parent = parent.parentElement) {
        if (surfaceCandidate(parent) || (parent.matches && parent.matches(controls))) surface = false;
      }
      setClass(node, 'club-liquid-surface', Boolean(surface));
      setClass(node, 'club-liquid-control', Boolean(control));
      // 自有默认值阻止父表面的 active=1 被子按钮继承。
      if ((surface || control) && node !== active && node.style && node.style.setProperty) node.style.setProperty('--club-pointer-active', '0');
    }

    function markTree(node) {
      if (!node) return;
      markOne(node);
      if (node.querySelectorAll) node.querySelectorAll(surfaces + ', ' + controls + ', ' + marked).forEach(markOne);
    }

    function reset() {
      if (frame !== null) global.cancelAnimationFrame(frame);
      frame = null;
      pending = null;
      if (active && active.style && active.style.setProperty) active.style.setProperty('--club-pointer-active', '0');
      active = null;
    }

    function targetFor(node) {
      if (node && node.nodeType === 3) node = node.parentElement;
      var target = closest(node, marked);
      if (!target || target.isConnected === false || closest(target, excluded) || closest(target, '[hidden], [inert], [aria-hidden="true"]')) return null;
      if (target.disabled || (target.getAttribute && target.getAttribute('aria-disabled') === 'true')) return null;
      // 数据/棋盘区域不追光；按钮中的 SVG 图标仍属于按钮的命中区域。
      if (closest(node, '.board, canvas, table, pre, .chat-model-menu, .club-assistant-frame')) return null;
      return target;
    }

    function render() {
      frame = null;
      var point = pending;
      pending = null;
      if (!tracking || !point || targetFor(point.node) !== point.target) { reset(); return; }
      var node = point.target;
      if (!node.style || !node.style.setProperty || !node.getBoundingClientRect) { reset(); return; }
      var rect = node.getBoundingClientRect(); // 每个实际渲染只读取当前目标一次。
      if (!(rect.width > 0 && rect.height > 0)) { reset(); return; }
      node.style.setProperty('--club-pointer-x', Math.max(0, Math.min(rect.width, point.x - rect.left)) + 'px');
      node.style.setProperty('--club-pointer-y', Math.max(0, Math.min(rect.height, point.y - rect.top)) + 'px');
      node.style.setProperty('--club-pointer-active', '1');
    }

    function pointAt(event) {
      if (!tracking) return;
      // 混合设备上的触屏/触笔不继承桌面鼠标的悬停状态。
      if (event.pointerType && event.pointerType !== 'mouse') { reset(); return; }
      var target = targetFor(event.target);
      if (!target || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) { reset(); return; }
      if (active !== target) { reset(); active = target; }
      pending = { target: target, node: event.target, x: event.clientX, y: event.clientY };
      if (frame === null) frame = global.requestAnimationFrame(render);
    }

    function pointOut(event) {
      if (active && targetFor(event.relatedTarget) !== active) reset();
    }

    function stopTracking() {
      reset();
      if (!tracking) return;
      tracking = false;
      document.removeEventListener('pointerover', pointAt, passive);
      document.removeEventListener('pointermove', pointAt, passive);
      document.removeEventListener('pointerout', pointOut, passive);
      document.removeEventListener('pointercancel', reset, passive);
      global.removeEventListener('blur', reset);
    }

    function refresh() {
      stopTracking();
      if (watcher) watcher.disconnect();
      watcher = null;
      if (suspended || document.visibilityState === 'hidden') return;
      markTree(document.body);
      if (typeof global.MutationObserver === 'function') {
        try {
          watcher = new global.MutationObserver(function (records) {
            records.forEach(function (record) {
              if (record.type === 'attributes') markTree(record.target);
              else if (record.addedNodes) record.addedNodes.forEach(markTree);
            });
            if (active && targetFor(active) !== active) reset();
          });
          watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'inert', 'aria-hidden', 'disabled', 'aria-disabled'] });
        } catch (_error) {
          if (watcher) watcher.disconnect();
          watcher = null;
        }
      }
      if (media.length !== 3 || !media[0].matches || media[1].matches || media[2].matches ||
          !global.PointerEvent || typeof global.requestAnimationFrame !== 'function' || typeof global.cancelAnimationFrame !== 'function' ||
          !document.addEventListener || !document.removeEventListener || !global.removeEventListener) return;
      tracking = true;
      document.addEventListener('pointerover', pointAt, passive);
      document.addEventListener('pointermove', pointAt, passive);
      document.addEventListener('pointerout', pointOut, passive);
      document.addEventListener('pointercancel', reset, passive);
      global.addEventListener('blur', reset);
    }

    function start() {
      if (bound) return;
      bound = true;
      ['(hover: hover) and (pointer: fine)', '(prefers-reduced-motion: reduce)', '(prefers-reduced-transparency: reduce)'].forEach(function (query) {
        try {
          var item = global.matchMedia(query);
          if (!item) return;
          media.push(item);
          if (item.addEventListener) item.addEventListener('change', refresh);
          else if (item.addListener) item.addListener(refresh);
        } catch (_error) { /* 能力不完整时只保留静态材质标记。 */ }
      });
      if (global.addEventListener) {
        global.addEventListener('pagehide', function () { suspended = true; refresh(); });
        global.addEventListener('pageshow', function () { suspended = false; refresh(); });
      }
      if (document.addEventListener) document.addEventListener('visibilitychange', refresh);
      refresh();
    }

    return { start: start };
  }

  var lighting = createClubLiquidLighting();
  global.ClubLiquidLighting = lighting;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lighting.start, { once: true });
  else lighting.start();
})(window);
