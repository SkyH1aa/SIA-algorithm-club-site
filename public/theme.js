(() => {
  const STORAGE_KEY = 'algorithm-club-theme-mode';
  const MODES = ['auto', 'light', 'dark'];
  const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/club-drive`;

  let currentMode = 'auto';
  let appliedTheme = 'dark';
  let syncTimer = null;
  let authClient = null;
  let latestToken = null;
  let remoteSyncReady = false;

  function beijingParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return { hour, minute };
  }

  function themeByBeijingTime(date = new Date()) {
    const { hour } = beijingParts(date);
    // 北京时间 06:00–17:59 亮色，18:00–次日 05:59 暗色
    return hour >= 6 && hour < 18 ? 'light' : 'dark';
  }

  function normalizeMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return MODES.includes(mode) ? mode : 'auto';
  }

  function readStoredMode() {
    try {
      return normalizeMode(localStorage.getItem(STORAGE_KEY) || 'auto');
    } catch (_error) {
      return 'auto';
    }
  }

  function writeStoredMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (_error) {
      /* ignore quota / private mode */
    }
  }

  function resolveTheme(mode = currentMode) {
    const normalized = normalizeMode(mode);
    return normalized === 'auto' ? themeByBeijingTime() : normalized;
  }

  function applyTheme(theme, { silent } = {}) {
    const next = theme === 'light' ? 'light' : 'dark';
    const root = document.documentElement;
    root.setAttribute('data-theme', next);
    root.style.colorScheme = next;
    const changed = appliedTheme !== next;
    appliedTheme = next;
    if (!silent && changed) {
      window.dispatchEvent(new CustomEvent('club:themechange', {
        detail: { mode: currentMode, theme: appliedTheme }
      }));
    }
    return appliedTheme;
  }

  function setMode(mode, { persist = true, syncRemote = true, silent = false } = {}) {
    currentMode = normalizeMode(mode);
    if (persist) writeStoredMode(currentMode);
    applyTheme(resolveTheme(currentMode), { silent });
    refreshPickerUI();
    if (!silent) {
      window.dispatchEvent(new CustomEvent('club:thememodechange', {
        detail: { mode: currentMode, theme: appliedTheme }
      }));
    }
    if (syncRemote && latestToken) {
      void pushRemotePreference(currentMode).then((ok) => {
        window.dispatchEvent(new CustomEvent('club:themesave', {
          detail: {
            ok: !!ok,
            mode: currentMode,
            theme: appliedTheme,
            remote: true
          }
        }));
      });
    } else if (!silent) {
      window.dispatchEvent(new CustomEvent('club:themesave', {
        detail: {
          ok: true,
          mode: currentMode,
          theme: appliedTheme,
          remote: false,
          guest: !latestToken
        }
      }));
    }
    return { mode: currentMode, theme: appliedTheme };
  }

  function refreshPickerUI() {
    document.querySelectorAll('[data-theme-mode]').forEach((el) => {
      const mode = normalizeMode(el.getAttribute('data-theme-mode'));
      el.classList.toggle('is-active', mode === currentMode);
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        el.setAttribute('aria-pressed', mode === currentMode ? 'true' : 'false');
      }
    });
    document.querySelectorAll('[data-theme-hint]').forEach((el) => {
      const theme = appliedTheme;
      const autoText = theme === 'light'
        ? (window.ClubI18n?.t?.('theme.hintAutoLight') || '当前按北京时间自动切换：现在是亮色时段（06:00–18:00）。')
        : (window.ClubI18n?.t?.('theme.hintAutoDark') || '当前按北京时间自动切换：现在是暗色时段（18:00–次日 06:00）。');
      const lightText = window.ClubI18n?.t?.('theme.hintLight') || '已固定为亮色主题。';
      const darkText = window.ClubI18n?.t?.('theme.hintDark') || '已固定为暗色主题。';
      el.textContent = currentMode === 'auto' ? autoText : (currentMode === 'light' ? lightText : darkText);
    });
  }

  function msUntilNextBoundary(date = new Date()) {
    const { hour, minute } = beijingParts(date);
    const minutesNow = hour * 60 + minute;
    const boundaries = [6 * 60, 18 * 60];
    let next = boundaries.find((m) => m > minutesNow);
    if (next == null) next = boundaries[0] + 24 * 60;
    const deltaMin = next - minutesNow;
    // 多等 1 秒，避免边界抖动
    return Math.max(1000, deltaMin * 60 * 1000) + 1000;
  }

  function scheduleAutoTick() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    const tick = () => {
      if (currentMode === 'auto') {
        applyTheme(resolveTheme('auto'));
        refreshPickerUI();
      }
      syncTimer = setTimeout(tick, msUntilNextBoundary());
    };
    syncTimer = setTimeout(tick, msUntilNextBoundary());
  }

  async function fetchRemotePreference(token) {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        apikey: SUPABASE_KEY
      },
      body: JSON.stringify({ action: 'member_theme_get' })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || '读取主题偏好失败');
    }
    return normalizeMode(payload.theme_mode || payload.themeMode || 'auto');
  }

  async function pushRemotePreference(mode) {
    if (!latestToken) return false;
    try {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${latestToken}`,
          apikey: SUPABASE_KEY
        },
        body: JSON.stringify({ action: 'member_theme_set', themeMode: mode })
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => ({}));
      return !payload.error;
    } catch (_error) {
      /* 网络失败时保留本地偏好 */
      return false;
    }
  }

  async function syncFromSession(session) {
    latestToken = session?.access_token || null;
    if (!latestToken) {
      remoteSyncReady = false;
      return;
    }
    try {
      const remoteMode = await fetchRemotePreference(latestToken);
      remoteSyncReady = true;
      setMode(remoteMode, { persist: true, syncRemote: false, silent: false });
    } catch (_error) {
      remoteSyncReady = false;
      // 表未部署时静默回退本地偏好
    }
  }

  function bindAuthSync() {
    if (!window.supabase || authClient) return;
    try {
      authClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      authClient.auth.getSession().then(({ data: { session } }) => {
        void syncFromSession(session);
      }).catch(() => {});
      authClient.auth.onAuthStateChange((_event, session) => {
        void syncFromSession(session);
      });
    } catch (_error) {
      authClient = null;
    }
  }

  function bindPickerClicks(root = document) {
    root.querySelectorAll('[data-theme-mode]').forEach((el) => {
      if (el.__clubThemeBound) return;
      el.__clubThemeBound = true;
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const mode = el.getAttribute('data-theme-mode');
        setMode(mode, { persist: true, syncRemote: true });
      });
    });
  }

  // 尽早应用，减少闪烁
  currentMode = readStoredMode();
  applyTheme(resolveTheme(currentMode), { silent: true });

  window.ClubTheme = {
    STORAGE_KEY,
    MODES: [...MODES],
    getMode: () => currentMode,
    getTheme: () => appliedTheme,
    resolveTheme,
    themeByBeijingTime,
    setMode,
    applyCurrent: () => applyTheme(resolveTheme(currentMode)),
    refreshPickerUI,
    bindPickerClicks,
    isRemoteSynced: () => remoteSyncReady
  };

  function boot() {
    bindPickerClicks(document);
    refreshPickerUI();
    scheduleAutoTick();
    bindAuthSync();
    window.addEventListener('club:langchange', () => refreshPickerUI());
    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('[data-theme-mode]');
      if (!target || target.__clubThemeBound) return;
      bindPickerClicks(document);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
