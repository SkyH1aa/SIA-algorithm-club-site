(() => {
  const STORAGE_KEY = 'algorithm-club-lang';
  const SUPPORTED = new Set(['zh', 'en']);
  const DEFAULT_LANG = 'zh';

  const state = {
    lang: DEFAULT_LANG,
    dict: Object.create(null),
    ready: false
  };

  function normalizeLang(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw.startsWith('en')) return 'en';
    if (raw.startsWith('zh')) return 'zh';
    return DEFAULT_LANG;
  }

  function readStoredLang() {
    try {
      return normalizeLang(localStorage.getItem(STORAGE_KEY));
    } catch (_error) {
      return DEFAULT_LANG;
    }
  }

  function writeStoredLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_error) {
      /* storage may be unavailable */
    }
  }

  function deepGet(source, path) {
    if (!source || !path) return undefined;
    return String(path).split('.').reduce((acc, key) => {
      if (acc == null) return undefined;
      return acc[key];
    }, source);
  }

  function format(template, vars) {
    if (template == null) return '';
    const text = String(template);
    if (!vars || typeof vars !== 'object') return text;
    return text.replace(/\{(\w+)\}/g, (_, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
  }

  function resolve(key, lang = state.lang) {
    if (!key) return undefined;
    // init() 之前（内联脚本在解析期调用 t）state.dict 还是空的，
    // 此时直接读已内联的 ClubI18nDict，避免返回原始 key。
    const globalDict = window.ClubI18nDict || {};
    const pack = (state.dict[lang] && Object.keys(state.dict[lang]).length)
      ? state.dict[lang]
      : (globalDict[lang] || {});
    const fallback = (state.dict.zh && Object.keys(state.dict.zh).length)
      ? state.dict.zh
      : (globalDict.zh || {});
    const hit = deepGet(pack, key);
    if (hit != null) return hit;
    return deepGet(fallback, key);
  }

  function t(key, vars, lang) {
    const value = resolve(key, lang || state.lang);
    if (value == null) return key;
    return format(value, vars);
  }

  function applyNode(node) {
    if (!node || node.nodeType !== 1) return;

    const key = node.getAttribute('data-i18n');
    if (key) {
      const mode = node.getAttribute('data-i18n-mode') || 'text';
      let vars;
      try { vars = JSON.parse(node.getAttribute('data-i18n-vars') || 'null') || undefined; } catch (_error) { vars = undefined; }
      const value = t(key, vars);
      if (mode === 'html') node.innerHTML = value;
      else node.textContent = value;
    }

    const attrRaw = node.getAttribute('data-i18n-attr');
    if (attrRaw) {
      attrRaw.split(';').forEach((pair) => {
        const trimmed = pair.trim();
        if (!trimmed) return;
        const sep = trimmed.indexOf(':');
        if (sep <= 0) return;
        const attr = trimmed.slice(0, sep).trim();
        const attrKey = trimmed.slice(sep + 1).trim();
        if (!attr || !attrKey) return;
        node.setAttribute(attr, t(attrKey));
      });
    }

    const placeholderKey = node.getAttribute('data-i18n-placeholder');
    if (placeholderKey) node.setAttribute('placeholder', t(placeholderKey));

    const titleKey = node.getAttribute('data-i18n-title');
    if (titleKey) node.setAttribute('title', t(titleKey));

    const ariaKey = node.getAttribute('data-i18n-aria');
    if (ariaKey) node.setAttribute('aria-label', t(ariaKey));
  }

  function apply(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-i18n], [data-i18n-attr], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria]').forEach(applyNode);

    const titleKey = document.documentElement.getAttribute('data-i18n-title-key');
    if (titleKey) document.title = t(titleKey);

    document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';
    document.documentElement.setAttribute('data-lang', state.lang);
    document.documentElement.classList.toggle('lang-en', state.lang === 'en');
    document.documentElement.classList.toggle('lang-zh', state.lang === 'zh');
  }

  function setLang(nextLang, options = {}) {
    const lang = normalizeLang(nextLang);
    const changed = lang !== state.lang;
    state.lang = lang;
    writeStoredLang(lang);
    // 词典按语言分包：切到尚未加载的语言时先异步补载，再应用与广播，
    // 否则界面会短暂显示 key 本身。
    const loader = window.ClubI18nDictLoader;
    if (loader && loader.loaded && !loader.loaded[lang]) {
      return loader.load(lang).then(() => {
        if (loader.loaded.zh && !state.dict.zh) state.dict.zh = Object.create(null);
        mergeDict(window.ClubI18nDict);
        if (options.apply !== false) apply(document);
        if (changed || options.forceEvent) {
          window.dispatchEvent(new CustomEvent('club:langchange', { detail: { lang } }));
        }
        return lang;
      });
    }
    if (options.apply !== false) apply(document);
    if (changed || options.forceEvent) {
      window.dispatchEvent(new CustomEvent('club:langchange', { detail: { lang } }));
    }
    return lang;
  }

  function mergeDict(extra) {
    if (!extra || typeof extra !== 'object') return;
    ['zh', 'en'].forEach((lang) => {
      if (!extra[lang] || typeof extra[lang] !== 'object') return;
      state.dict[lang] = deepMerge(state.dict[lang] || Object.create(null), extra[lang]);
    });
  }

  function deepMerge(target, source) {
    Object.keys(source).forEach((key) => {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = deepMerge(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
      } else {
        target[key] = value;
      }
    });
    return target;
  }

  function mountSwitcher(host, options = {}) {
    if (!host) return null;
    const existing = host.querySelector('[data-lang-switcher]');
    if (existing) {
      syncSwitcher(existing);
      return existing;
    }

    const wrap = document.createElement('div');
    wrap.className = options.className || 'lang-switcher';
    wrap.setAttribute('data-lang-switcher', '1');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Language');

    const zhBtn = document.createElement('button');
    zhBtn.type = 'button';
    zhBtn.dataset.lang = 'zh';
    zhBtn.textContent = '中文';

    const enBtn = document.createElement('button');
    enBtn.type = 'button';
    enBtn.dataset.lang = 'en';
    enBtn.textContent = 'EN';

    wrap.append(zhBtn, enBtn);
    wrap.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-lang]');
      if (!btn) return;
      setLang(btn.dataset.lang);
      syncSwitcher(wrap);
    });

    host.appendChild(wrap);
    syncSwitcher(wrap);
    return wrap;
  }

  function syncSwitcher(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-lang-switcher] button[data-lang]').forEach((btn) => {
      const active = btn.dataset.lang === state.lang;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function init(options = {}) {
    if (options.dict) mergeDict(options.dict);
    if (window.ClubI18nDict) mergeDict(window.ClubI18nDict);
    state.lang = readStoredLang();
    state.ready = true;
    if (options.apply !== false) apply(document);
    syncSwitcher(document);
    // 英文词典是增量包：首次 boot 时若当前语言是 en 且尚未加载，补载后重绘。
    const loader = window.ClubI18nDictLoader;
    if (state.lang === 'en' && loader && loader.loaded && !loader.loaded.en && typeof loader.load === 'function') {
      loader.load('en').then(() => {
        mergeDict(window.ClubI18nDict);
        apply(document);
        syncSwitcher(document);
        try {
          window.dispatchEvent(new CustomEvent('club:langchange', { detail: { lang: state.lang } }));
        } catch (_error) { /* ignore */ }
      });
    }
    return state.lang;
  }

  window.ClubI18n = {
    STORAGE_KEY,
    t,
    apply,
    applyNode,
    setLang,
    getLang: () => state.lang,
    mergeDict,
    mountSwitcher,
    syncSwitcher,
    init,
    format
  };

  // Auto-init after dictionaries / DOM are ready.
  function boot() {
    if (!window.ClubI18n) return;
    const lang = init({ apply: true });
    // 首次引导完成后广播一次，触发页面内同步期注册的动态渲染器刷新，
    // 解决在词典合并前就执行 t() 导致的状态/说明文本空白的竞态。
    try {
      window.dispatchEvent(new CustomEvent('club:langchange', { detail: { lang } }));
    } catch (_error) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    // Defer so page-level dict scripts can attach ClubI18nDict first.
    setTimeout(boot, 0);
  }
})();
