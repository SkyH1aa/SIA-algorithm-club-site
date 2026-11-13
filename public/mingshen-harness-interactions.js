/* Harness state and reading progress; club-shell alone owns tab selection/focus. */
(() => {
  'use strict';

  function boot() {
    const page = document.body;
    if (!page || !page.classList.contains('harness-page')) return;

    const states = {
      flow: ['plan', 'work', 'review'],
      code: ['context', 'diff', 'restore'],
      docs: ['read', 'compose', 'export']
    };
    const tabs = Array.from(page.querySelectorAll('[data-harness-tabs]')).filter(node =>
      node.hasAttribute('data-club-tabs')).map(node => ({
      node,
      buttons: Array.from(node.querySelectorAll('[role="tab"], button[data-tab-target]')),
      indicator: node.querySelector('.harness-tab-indicator'),
      explorer: node.closest('[data-harness-explorer]')
    }));
    const nav = page.querySelector('[data-harness-chapters]');
    const progress = nav && nav.querySelector('[data-harness-progress]');
    const topbar = page.querySelector('.topbar');
    const chapters = nav ? Array.from(nav.querySelectorAll('a[href]')).map(link => {
      const href = link.getAttribute('href');
      if (!['#collaboration', '#craft', '#models', '#download'].includes(href)) return null;
      const section = document.getElementById(href.slice(1));
      return section && page.contains(section) ? { link, section } : null;
    }).filter(Boolean) : [];
    let suspended = false;
    let frame = null;
    let generation = 0;
    let layoutDirty = false;
    let chaptersDirty = false;
    let anchorOffset = 0;
    let listening = false;
    let intersection = null;
    let resizing = null;
    let canFrame = typeof window.requestAnimationFrame === 'function' &&
      typeof window.cancelAnimationFrame === 'function';

    function active() {
      return !suspended && !document.hidden && document.visibilityState !== 'hidden';
    }

    function visible(node) {
      if (!node) return false;
      for (let current = node; current && current !== page.parentElement; current = current.parentElement) {
        if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
      }
      return true;
    }

    function targetOf(button) {
      return button.getAttribute('data-tab-target') || button.getAttribute('aria-controls') || '';
    }

    function selected(binding) {
      const button = binding.buttons.find(node => node.getAttribute('aria-selected') === 'true');
      const panel = button && document.getElementById(targetOf(button));
      return panel && page.contains(panel) && visible(panel) ? { button, panel } : null;
    }

    function syncExplorer(binding) {
      const chosen = selected(binding);
      const explorer = binding.explorer;
      if (!chosen || !explorer || !explorer.contains(chosen.panel)) return;
      const allowed = states[explorer.getAttribute('data-harness-explorer')];
      const state = chosen.panel.getAttribute('data-harness-state');
      if (allowed && allowed.includes(state)) explorer.dataset.harnessActive = state;
    }

    function measureIndicator(binding) {
      const { node, indicator } = binding;
      const chosen = selected(binding);
      function reset() { node.removeAttribute('data-harness-indicator-ready'); }
      if (!indicator || !chosen || !visible(node) || !visible(chosen.button)) { reset(); return; }
      try {
        // Never sample an inactive button or a tablist hidden by a parent panel.
        if ((typeof node.getClientRects === 'function' && !node.getClientRects().length) ||
            (typeof chosen.button.getClientRects === 'function' && !chosen.button.getClientRects().length)) {
          reset(); return;
        }
        const outer = node.getBoundingClientRect();
        const inner = chosen.button.getBoundingClientRect();
        if (![outer.left, outer.top, outer.width, outer.height, inner.left, inner.top, inner.width, inner.height]
          .every(Number.isFinite) || outer.width <= 0 || outer.height <= 0 || inner.width <= 0 || inner.height <= 0) {
          reset(); return;
        }
        const x = inner.left - outer.left - (node.clientLeft || 0) + (node.scrollLeft || 0);
        const y = inner.top - outer.top - (node.clientTop || 0) + (node.scrollTop || 0);
        node.style.setProperty('--harness-tab-x', `${x.toFixed(2)}px`);
        node.style.setProperty('--harness-tab-y', `${y.toFixed(2)}px`);
        node.style.setProperty('--harness-tab-width', `${inner.width.toFixed(2)}px`);
        node.style.setProperty('--harness-tab-height', `${inner.height.toFixed(2)}px`);
        node.setAttribute('data-harness-indicator-ready', 'true');
      } catch { reset(); /* Selected-button styling remains the fallback. */ }
    }

    function rectOf(node) {
      if (!visible(node)) return null;
      try {
        if (typeof node.getClientRects === 'function' && !node.getClientRects().length) return null;
        const rect = node.getBoundingClientRect();
        return Number.isFinite(rect.top) && Number.isFinite(rect.height) && rect.height > 0 ? rect : null;
      } catch { return null; }
    }

    function measureAnchorOffset() {
      anchorOffset = 0;
      if (typeof window.getComputedStyle !== 'function') return;
      chapters.forEach(chapter => {
        if (!visible(chapter.section)) return;
        try {
          const margin = Number.parseFloat(window.getComputedStyle(chapter.section).scrollMarginTop);
          if (Number.isFinite(margin)) anchorOffset = Math.max(anchorOffset, margin);
        } catch { /* The measured navigation or 150px fallback remains sufficient. */ }
      });
    }

    function updateChapters() {
      if (!nav || !chapters.length) return;
      const height = Number(window.innerHeight);
      if (!Number.isFinite(height) || height <= 0) return;
      const navRect = rectOf(nav);
      const barRect = rectOf(topbar);
      // Native anchors stop at CSS scroll-margin-top, which can include breathing
      // room beyond both sticky bars. Use that same edge for chapter selection.
      const offset = Math.min(height - 1, Math.max(anchorOffset,
        navRect && barRect ? navRect.height + barRect.height : 150));
      const measured = chapters.map(chapter => ({ ...chapter, rect: rectOf(chapter.section) }))
        .filter(chapter => chapter.rect);
      if (!measured.length) {
        chapters.forEach(chapter => chapter.link.removeAttribute('aria-current'));
        nav.style.setProperty('--harness-progress', '0');
        if (progress) progress.style.setProperty('--harness-progress', '0');
        return;
      }
      let current = measured[0];
      measured.forEach(chapter => { if (chapter.rect.top <= offset + 1) current = chapter; });
      const first = measured[0].rect;
      const last = measured[measured.length - 1].rect;
      // Read from the first chapter's start to the last chapter's bottom reaching
      // the viewport bottom. Short pages and overscroll still have finite bounds.
      const distance = last.top + last.height - first.top - height + offset;
      let value = distance > 0 ? (offset - first.top) / distance : (first.top <= offset ? 1 : 0);
      const root = document.documentElement;
      const scrollY = Number.isFinite(window.scrollY) ? Math.max(0, window.scrollY) : Number(root && root.scrollTop) || 0;
      const total = Number(root && root.scrollHeight);
      if (total > height && scrollY > 0 && scrollY + height >= total - 2) {
        current = measured[measured.length - 1];
        value = 1;
      }
      value = Math.max(0, Math.min(1, value));
      chapters.forEach(chapter => {
        if (chapter.link === current.link) chapter.link.setAttribute('aria-current', 'location');
        else chapter.link.removeAttribute('aria-current');
      });
      const fraction = value.toFixed(4);
      nav.style.setProperty('--harness-progress', fraction);
      if (progress) progress.style.setProperty('--harness-progress', fraction);
    }

    function flush() {
      frame = null;
      if (!active()) return;
      const layout = layoutDirty;
      const reading = chaptersDirty;
      layoutDirty = false;
      chaptersDirty = false;
      if (layout) {
        tabs.forEach(measureIndicator);
        measureAnchorOffset();
      }
      if (reading) updateChapters();
    }

    function schedule(layout, reading) {
      if (!active()) return;
      layoutDirty = layoutDirty || layout;
      chaptersDirty = chaptersDirty || reading;
      if (frame !== null) return;
      if (!canFrame) { flush(); return; }
      const ticket = ++generation;
      try {
        frame = window.requestAnimationFrame(() => { if (ticket === generation) flush(); });
      } catch { canFrame = false; flush(); }
    }

    function refreshLayout() { schedule(true, true); }
    function onScroll() { schedule(false, true); }

    function stop() {
      generation += 1;
      if (frame !== null) {
        try { window.cancelAnimationFrame(frame); } catch { /* Tickets also guard stale callbacks. */ }
      }
      frame = null;
      layoutDirty = false;
      chaptersDirty = false;
      if (listening) window.removeEventListener('scroll', onScroll);
      listening = false;
      const oldIntersection = intersection;
      const oldResizing = resizing;
      intersection = null;
      resizing = null;
      try { if (oldIntersection) oldIntersection.disconnect(); } catch { /* Optional API. */ }
      try { if (oldResizing) oldResizing.disconnect(); } catch { /* Optional API. */ }
    }

    function resume() {
      stop();
      if (!active()) return;
      tabs.forEach(syncExplorer);
      if (chapters.length) {
        window.addEventListener('scroll', onScroll, { passive: true });
        listening = true;
        try {
          if (typeof window.IntersectionObserver === 'function') {
            const observer = new window.IntersectionObserver(() => {
              if (intersection === observer) onScroll();
            }, { threshold: [0, 1] });
            intersection = observer;
            chapters.forEach(chapter => observer.observe(chapter.section));
          }
        } catch {
          try { if (intersection) intersection.disconnect(); } catch { /* Scroll still works. */ }
          intersection = null;
        }
      }
      try {
        if (typeof window.ResizeObserver === 'function') {
          const observer = new window.ResizeObserver(() => { if (resizing === observer) refreshLayout(); });
          resizing = observer;
          tabs.forEach(binding => {
            observer.observe(binding.node);
            binding.buttons.forEach(button => observer.observe(button));
          });
          if (nav) observer.observe(nav);
          if (topbar) observer.observe(topbar);
          chapters.forEach(chapter => observer.observe(chapter.section));
        }
      } catch {
        try { if (resizing) resizing.disconnect(); } catch { /* Resize/lang events remain. */ }
        resizing = null;
      }
      refreshLayout();
    }

    page.addEventListener('club:tabchange', event => {
      const target = event.detail && event.detail.target;
      if (typeof target !== 'string' || !active()) return;
      const binding = tabs.find(item => item.buttons.some(button => targetOf(button) === target));
      const chosen = binding && selected(binding);
      if (!chosen || targetOf(chosen.button) !== target) return;
      syncExplorer(binding);
      // The shell has already unhidden the panel; measure once layout settles.
      schedule(true, true);
    });
    window.addEventListener('resize', refreshLayout, { passive: true });
    window.addEventListener('club:langchange', refreshLayout);
    window.addEventListener('hashchange', onScroll);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pagehide', () => { suspended = true; stop(); });
    window.addEventListener('pageshow', () => {
      if (!suspended) return;
      suspended = false;
      resume();
    });
    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
      document.fonts.addEventListener('loadingdone', refreshLayout);
    }
    resume();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
