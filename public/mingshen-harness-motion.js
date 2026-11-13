/* Product choreography only; club-shell owns tabs, focus and generic reveals. */
(() => {
  'use strict';

  function boot() {
    const page = document.body;
    if (!page || !page.classList.contains('harness-page')) return;

    const stage = page.querySelector('[data-harness-stage]');
    const screen = stage && stage.querySelector('[data-harness-screen]');
    const flow = page.querySelector('[data-harness-flow]');
    const overview = document.getElementById('harnessViewOverview');
    const pointers = Array.from(page.querySelectorAll('[data-harness-pointer]')).filter(node =>
      node.classList.contains('harness-hero-track') || node.classList.contains('harness-screen-wrap'))
      .map(node => ({ node, inside: false, bound: false, frame: null, ticket: 0, point: null }));
    const animations = new Map();
    let observer = null;
    let frame = null;
    let stageInside = false;
    let scrolling = false;
    let suspended = false;
    let flowPlayed = false;
    let canFrame = typeof window.requestAnimationFrame === 'function' &&
      typeof window.cancelAnimationFrame === 'function';

    function media(query) {
      try { return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null; }
      catch { return null; }
    }
    const reduced = media('(prefers-reduced-motion: reduce)');
    const desktop = media('(min-width: 901px)');
    const fine = media('(hover: hover) and (pointer: fine)');

    function visible(node) {
      for (let current = node; current && current !== page.parentElement; current = current.parentElement) {
        // Decorative art intentionally has aria-hidden; it can still be visible.
        if (current.hidden) return false;
      }
      return Boolean(node);
    }

    function screenVisible() { return screen && visible(screen) && (!overview || visible(overview)); }

    function enabled() {
      // Unknown preferences fail static, not animated; the document stays readable.
      return !suspended && !document.hidden && document.visibilityState !== 'hidden' &&
        Boolean(reduced && !reduced.matches && desktop && desktop.matches);
    }

    function cancelAnimation(animation) {
      animations.delete(animation);
      try {
        animation.onfinish = null;
        animation.oncancel = null;
        if (typeof animation.cancel === 'function') animation.cancel();
      } catch { /* A partial WAAPI implementation must not affect the page or loader. */ }
    }

    function cancelAnimations(scope) {
      Array.from(animations).forEach(([animation, owner]) => {
        if (!scope || owner === scope) cancelAnimation(animation);
      });
    }

    function animate(node, keyframes, options, owner = node) {
      if (!node || !enabled() || typeof node.animate !== 'function') return;
      let animation;
      try {
        // No forwards fill or inline hidden state: cancellation reveals the CSS default.
        animation = node.animate(keyframes, { ...options, iterations: 1, fill: 'none' });
        if (!animation) return;
        animations.set(animation, owner);
        animation.onfinish = () => cancelAnimation(animation);
        animation.oncancel = () => animations.delete(animation);
        // Do not read Animation.finished: cancel() rejects that optional promise.
      } catch {
        if (animation) cancelAnimation(animation);
      }
    }

    function trace(path, length, duration, delay = 0, owner = path) {
      if (!Number.isFinite(length) || length <= 0) return;
      animate(path, [
        { strokeDasharray: `${length} ${length}`, strokeDashoffset: length },
        { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 }
      ], { duration, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }, owner);
    }

    function hero() {
      // Called only at boot, never on visibility or bfcache restoration.
      page.querySelectorAll('.harness-hero-word').forEach((node, index) => {
        animate(node, [
          { opacity: 0.65, transform: 'translateY(14px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 620, delay: Math.min(index, 2) * 60, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      });
      animate(page.querySelector('.harness-hero-copy'), [
        { opacity: 0.75, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 640, delay: 100, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      if (!enabled()) return;
      page.querySelectorAll('.harness-hero-track path').forEach(path => {
        try {
          const normalized = Number(path.getAttribute('pathLength'));
          const length = normalized > 0 ? normalized :
            (typeof path.getTotalLength === 'function' ? path.getTotalLength() : 0);
          trace(path, length, 760);
        } catch { /* SVG geometry APIs are optional, especially offline/older clients. */ }
      });
    }

    function workflow() {
      if (!flow || flowPlayed || !enabled()) return;
      flowPlayed = true;
      flow.querySelectorAll('.harness-flow-line path').forEach((path, index) => {
        trace(path, 1, 1000, Math.min(index, 2) * 160, flow);
      });
      flow.querySelectorAll('.harness-flow-step').forEach((node, index) => {
        // The three steps already exist visibly; motion explains the dependency order.
        animate(node, [{ opacity: 0.65 }, { opacity: 1 }], {
          duration: 520, delay: Math.min(index, 2) * 200, easing: 'ease-out'
        }, flow);
      });
    }

    function artwork(explorer) {
      if (!explorer || !enabled()) return;
      const art = explorer.querySelector('[data-harness-art]');
      if (!art || !visible(art)) return;
      animate(art, [
        { opacity: 0.78, clipPath: 'inset(0 1.5% 0 0)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0)' }
      ], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }, explorer);
      if (explorer.getAttribute('data-harness-explorer') === 'flow') {
        art.querySelectorAll('.harness-flow-line path').forEach((path, index) => {
          trace(path, 1, 460, Math.min(index, 2) * 30, explorer);
        });
      }
    }

    function pointerEnabled() { return enabled() && Boolean(fine && fine.matches) && canFrame; }

    function resetPointer(item) {
      item.ticket += 1;
      if (item.frame !== null) {
        try { window.cancelAnimationFrame(item.frame); } catch { /* Ticket guards stale callbacks. */ }
      }
      item.frame = null;
      item.point = null;
      item.node.style.setProperty('--harness-pointer-x', '50%');
      item.node.style.setProperty('--harness-pointer-y', '50%');
      item.node.style.setProperty('--harness-pointer-active', '0');
      item.node.style.setProperty('--harness-pointer-tilt-x', '0deg');
      item.node.style.setProperty('--harness-pointer-tilt-y', '0deg');
    }

    function updatePointer(item) {
      item.frame = null;
      if (!pointerEnabled() || !item.inside || !item.point || !visible(item.node)) { resetPointer(item); return; }
      try {
        const rect = item.node.getBoundingClientRect();
        const [clientX, clientY] = item.point;
        if (![rect.left, rect.top, rect.width, rect.height, clientX, clientY].every(Number.isFinite) ||
            rect.width <= 0 || rect.height <= 0 || rect.top >= window.innerHeight || rect.top + rect.height <= 0) {
          resetPointer(item); return;
        }
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        item.node.style.setProperty('--harness-pointer-x', `${(x * 100).toFixed(2)}%`);
        item.node.style.setProperty('--harness-pointer-y', `${(y * 100).toFixed(2)}%`);
        item.node.style.setProperty('--harness-pointer-tilt-x', `${((0.5 - y) * 2.4).toFixed(3)}deg`);
        item.node.style.setProperty('--harness-pointer-tilt-y', `${((x - 0.5) * 2.4).toFixed(3)}deg`);
        item.node.style.setProperty('--harness-pointer-active', '1');
      } catch { resetPointer(item); }
    }

    pointers.forEach(item => {
      item.move = event => {
        if (event.pointerType !== 'mouse') { resetPointer(item); return; }
        if (!pointerEnabled() || !item.inside || !visible(item.node)) return;
        item.point = [event.clientX, event.clientY];
        if (item.frame !== null) return;
        const ticket = ++item.ticket;
        try {
          item.frame = window.requestAnimationFrame(() => { if (ticket === item.ticket) updatePointer(item); });
        } catch { resetPointer(item); }
      };
      item.leave = () => resetPointer(item);
    });

    function bindPointer(item, bind) {
      if (item.bound === bind) return;
      item.bound = bind;
      const method = bind ? 'addEventListener' : 'removeEventListener';
      item.node[method]('pointermove', item.move, { passive: true });
      item.node[method]('pointerleave', item.leave);
      item.node[method]('pointercancel', item.leave);
    }

    function resetScreen() {
      if (!screen || !screen.style || typeof screen.style.setProperty !== 'function') return;
      screen.style.setProperty('--harness-screen-tilt', '0deg');
      screen.style.setProperty('--harness-screen-scale', '1');
    }

    function cancelFrame() {
      if (frame === null) return;
      const pending = frame;
      frame = null;
      try { window.cancelAnimationFrame(pending); } catch { /* A stale frame also checks enabled(). */ }
    }

    function updateScreen() {
      frame = null;
      if (!enabled() || !stageInside || !screenVisible()) { resetScreen(); return; }
      try {
        const rect = stage.getBoundingClientRect();
        const height = window.innerHeight;
        if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(rect.top) ||
            !Number.isFinite(rect.height) || rect.height <= 0) {
          resetScreen();
          return;
        }
        const progress = Math.max(0, Math.min(1, (height - rect.top) / (height + rect.height)));
        // Only the dedicated inner screenshot consumes these; never transform the stage
        // or a shared reveal wrapper, and never sample transformed screen geometry.
        screen.style.setProperty('--harness-screen-tilt', `${(5 * (1 - progress)).toFixed(3)}deg`);
        screen.style.setProperty('--harness-screen-scale', (0.97 + 0.03 * progress).toFixed(4));
      } catch { resetScreen(); }
    }

    function scheduleScreen() {
      if (!canFrame || frame !== null || !stageInside || !screenVisible() || !enabled()) return;
      try { frame = window.requestAnimationFrame(updateScreen); }
      catch { canFrame = false; resetScreen(); }
    }

    function syncStage() {
      const run = enabled() && stageInside && screenVisible() && canFrame;
      if (scrolling && !run) window.removeEventListener('scroll', scheduleScreen);
      if (!scrolling && run) window.addEventListener('scroll', scheduleScreen, { passive: true });
      scrolling = Boolean(run);
      if (run) scheduleScreen();
      else { cancelFrame(); resetScreen(); }
    }

    function stopStage() {
      stageInside = false;
      syncStage();
    }

    function stopObserver() {
      const previous = observer;
      observer = null; // Ignore already-queued callbacks from a disconnected observer.
      if (previous) {
        try { previous.disconnect(); } catch { /* Static fallback. */ }
      }
      stopStage();
      pointers.forEach(item => { item.inside = false; bindPointer(item, false); resetPointer(item); });
    }

    function refresh() {
      stopObserver();
      cancelAnimations();
      if (!enabled() || typeof window.IntersectionObserver !== 'function' ||
          (!stage && !flow && !(pointerEnabled() && pointers.length))) return;
      try {
        const current = new window.IntersectionObserver(entries => {
          if (observer !== current || !enabled()) return;
          entries.forEach(entry => {
            const pointer = pointers.find(item => item.node === entry.target);
            if (pointer) {
              pointer.inside = Boolean(entry.isIntersecting);
              if (!pointer.inside) resetPointer(pointer);
            }
            if (entry.target === stage && screen && canFrame) {
              stageInside = Boolean(entry.isIntersecting);
              syncStage();
            } else if (entry.target === flow && entry.isIntersecting && !flowPlayed) {
              workflow();
              try { current.unobserve(flow); } catch { /* flowPlayed still prevents replay. */ }
            }
          });
        }, { threshold: 0 });
        observer = current;
        if (stage && screen && canFrame) current.observe(stage);
        if (flow && !flowPlayed) current.observe(flow);
        if (pointerEnabled()) pointers.forEach(item => { current.observe(item.node); bindPointer(item, true); });
      } catch { stopObserver(); }
    }

    function watchMedia(query) {
      if (!query) return;
      try {
        if (typeof query.addEventListener === 'function') {
          query.addEventListener('change', refresh);
          return;
        }
      } catch { /* Older WebKit can expose only the legacy listener. */ }
      try { if (typeof query.addListener === 'function') query.addListener(refresh); }
      catch { /* Preference APIs are optional. */ }
    }

    // The shared shell has already selected and unhidden the target panel. Only add
    // feedback; do not touch hidden/ARIA/tabIndex, selection, focus or keyboard logic.
    page.addEventListener('club:tabchange', event => {
      const target = event.detail && event.detail.target;
      if (typeof target !== 'string') return;
      const panel = document.getElementById(target);
      if (!panel || !page.contains(panel) || !visible(panel) ||
          !(panel.classList.contains('harness-view-panel') || panel.classList.contains('harness-demo-panel'))) return;
      const explorer = panel.closest('[data-harness-explorer]');
      const owner = explorer || stage || panel.parentElement;
      cancelAnimations(owner); // Interrupt only this component, preserving hero/other explorers.
      if (explorer && flow && explorer.contains(flow)) { cancelAnimations(flow); flowPlayed = true; }
      animate(panel, [
        { opacity: 0.72, clipPath: 'inset(0 0 5% 0)', transform: 'translateY(5px)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)' }
      ], { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }, owner);
      artwork(explorer);
      if (panel.classList.contains('harness-view-panel')) {
        syncStage();
        pointers.filter(item => item.node.classList.contains('harness-screen-wrap')).forEach(resetPointer);
      }
    });
    watchMedia(reduced);
    watchMedia(desktop);
    watchMedia(fine);
    window.addEventListener('blur', () => pointers.forEach(resetPointer));
    window.addEventListener('resize', scheduleScreen, { passive: true });
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pagehide', () => {
      suspended = true;
      stopObserver();
      cancelAnimations();
    });
    window.addEventListener('pageshow', () => {
      // The initial pageshow follows DOMContentLoaded; do not cancel its hero.
      if (!suspended) return;
      suspended = false;
      refresh();
    });
    refresh();
    hero();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
