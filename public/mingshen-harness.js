(() => {
  'use strict';
  const repository = 'https://github.com/SkyH1aa/MingshenHarness';
  const endpoint = 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/club-drive';
  const publicKey = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const links = [...document.querySelectorAll('[data-harness-download]')];
  const status = document.querySelector('[data-download-status]');
  let statusKey = 'harness.downloadFallback';

  function validDownloadUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f-\x9f\\]/.test(value)) return '';
    const trimmed = value.trim();
    if (!/^https:\/\/[^/\s?#]+(?:[/?#]|$)/i.test(trimmed) || /\s/.test(trimmed)) return '';
    try {
      const url = new URL(trimmed);
      const authority = trimmed.slice(trimmed.indexOf('//') + 2).split(/[/?#]/)[0];
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || authority.includes('@')) return '';
      return trimmed;
    } catch { return ''; }
  }

  function refreshDownload() {
    if (!status) return;
    status.dataset.i18n = statusKey;
    const translated = window.ClubI18n?.t(statusKey);
    if (translated && translated !== statusKey) status.textContent = translated;
  }

  async function loadDownload() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicKey },
        body: JSON.stringify({ action: 'mingshen_harness_download_get' }),
        signal: controller.signal, cache: 'no-store', credentials: 'omit'
      });
      if (!response.ok) return;
      const result = await response.json();
      const url = validDownloadUrl(result.downloadUrl);
      if (!url) return;
      links.forEach(link => { link.href = url; });
      statusKey = 'harness.downloadReady';
    } catch { /* Static repository links remain usable on old backends and offline. */ }
    finally { clearTimeout(timer); refreshDownload(); }
  }

  links.forEach(link => { link.href = repository; });
  window.addEventListener('club:langchange', refreshDownload);
  refreshDownload();
  setTimeout(refreshDownload, 0);
  loadDownload();
})();
