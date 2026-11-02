(() => {
  'use strict';

  // This module owns only DOM interaction. The existing chapter compositor
  // supplies --chapter-reveal; no second animation or scroll loop is needed.
  const menuButton = document.getElementById('menuButton');
  const nav = document.getElementById('nav');
  const mobile = matchMedia('(max-width: 900px)');
  function setMenu(open, restoreFocus = false) {
    nav.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    if (restoreFocus) menuButton.focus();
  }
  menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
  menuButton.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setMenu(true);
    nav.querySelector('a:not([hidden])')?.focus();
  });
  nav.addEventListener('click', event => {
    if (event.target.closest('a')) setMenu(false, mobile.matches);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('open')) {
      event.preventDefault();
      setMenu(false, true);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!nav.contains(event.target) && !menuButton.contains(event.target)) setMenu(false);
  });
  document.addEventListener('focusin', event => {
    if (!nav.contains(event.target) && !menuButton.contains(event.target)) setMenu(false);
  });
  mobile.addEventListener('change', () => setMenu(false));

  // Bounded capability examples live in home-capabilities.js.

  // Pointer and keyboard focus share the same planet-scene affordance.
  // Leaving a focused link with a pointer must not prematurely release it.
  let focusedWork = '';
  const rows = [...document.querySelectorAll('.planet-row')];
  const hovered = new Set();
  function updateWorkFocus() {
    const row = rows.find(item => item.contains(document.activeElement)) || [...hovered].pop();
    const id = row?.dataset.sceneFocus || '';
    if (id === focusedWork) return;
    focusedWork = id;
    dispatchEvent(new CustomEvent('zone:focus', { detail: { kind: id ? 'work' : 'none', id } }));
  }
  rows.forEach(row => {
    row.addEventListener('pointerenter', () => { hovered.add(row); updateWorkFocus(); }, { passive: true });
    row.addEventListener('pointerleave', () => { hovered.delete(row); updateWorkFocus(); }, { passive: true });
    row.addEventListener('pointercancel', () => { hovered.delete(row); updateWorkFocus(); }, { passive: true });
    row.addEventListener('focusin', updateWorkFocus);
    row.addEventListener('focusout', () => queueMicrotask(updateWorkFocus));
  });
  const releaseWork = () => {
    hovered.clear();
    if (!focusedWork) return;
    focusedWork = '';
    dispatchEvent(new CustomEvent('zone:focus', { detail: { kind: 'none', id: '' } }));
  };
  addEventListener('blur', releaseWork);
  addEventListener('pagehide', releaseWork);
  addEventListener('club:sceneprogress', event => {
    if (event.detail.section !== 'gomoku') releaseWork();
  });
})();
