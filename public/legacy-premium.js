/* Theme controls only: never read, call, replace or redraw a legacy game. */
(() => {
  'use strict';
  function boot() {
    const host = document.querySelector('[data-legacy-theme]');
    if (!host) return;
    const buttons = Array.from(host.querySelectorAll('button[data-legacy-mode]'));
    const labels = {
      zh: { group: '外观主题', auto: '自动', light: '日间', dark: '夜间' },
      en: { group: 'Appearance', auto: 'Auto', light: 'Day', dark: 'Night' }
    };
    function refresh() {
      const api = window.ClubTheme;
      const mode = api?.getMode?.() || '';
      const text = labels[document.documentElement.lang.startsWith('en') ? 'en' : 'zh'];
      host.setAttribute('aria-label', text.group);
      buttons.forEach((button) => {
        const value = button.dataset.legacyMode;
        button.disabled = typeof api?.setMode !== 'function';
        button.textContent = text[value];
        button.setAttribute('aria-pressed', String(value === mode));
        button.setAttribute('aria-label', text[value]);
      });
    }
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        window.ClubTheme?.setMode?.(button.dataset.legacyMode, { persist: true, syncRemote: false });
        refresh();
      });
    });
    // Historical games listen on document and consume Space. Isolate only the
    // theme controls so their native Space/Enter activation cannot play a move.
    host.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    window.addEventListener('club:themechange', refresh);
    window.addEventListener('club:thememodechange', refresh);
    window.addEventListener('club:langchange', refresh);
    refresh();
    setTimeout(refresh, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
