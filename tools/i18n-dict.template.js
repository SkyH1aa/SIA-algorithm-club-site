// 由 tools/build-i18n-dict.mjs 生成，请勿手工编辑。
//
// 中文词典完整内联在本文件里，保证 file:// 打开时也能立即生效；英文词典
// （i18n-dict-en.js）只在切换到英文时按需异步加载。
//
// 不要改回「document.write / 同步 XHR 注入外部中文包」的写法：file:// 下
// 同步 XHR 被浏览器拒绝，defer 阶段也不执行 document.write，会导致全站显示
// guide.h1、common.confirm 这类原始 key。
(() => {
  var BASE = (function () {
    var script = document.currentScript;
    if (!script || !script.src) return '';
    return script.src.replace(/[^/]*$/, '');
  })();

  var zh = window.ClubI18nDictZh || null;
  if (!zh) {
    zh = /*__ZH_DICT__*/ {};
  }

  var en = window.ClubI18nDictEn || null;

  function publish() {
    window.ClubI18nDict = { zh: zh || {}, en: en || {} };
    window.ClubI18nDictZh = zh;
    window.ClubI18nDictEn = en;
  }
  publish();

  function loadEnglish() {
    if (en) return Promise.resolve();
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = BASE + 'i18n-dict-en.js';
      script.onload = function () {
        en = window.ClubI18nDictEn || null;
        publish();
        resolve();
      };
      script.onerror = function () { resolve(); };
      document.head.appendChild(script);
    });
  }

  window.ClubI18nDictLoader = {
    load: function (lang) {
      return lang === 'en' ? loadEnglish() : Promise.resolve();
    },
    get loaded() { return { zh: Boolean(zh && Object.keys(zh).length), en: Boolean(en) }; }
  };
})();
