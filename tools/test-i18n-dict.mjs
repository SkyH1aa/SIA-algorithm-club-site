// Offline: node tools/test-i18n-dict.mjs
//
// Regression guard for the dictionary regression that made every page show raw
// keys (guide.h1, common.confirm) until the user clicked the language switcher.
//
// Root cause: i18n-dict.js was a loader that injected the Chinese bundle with
// document.write / synchronous XHR. Under file:// the browser rejects sync XHR
// and document.write does not run at defer time, so ClubI18nDict stayed empty.
//
// The Chinese dictionary must therefore be physically inline in i18n-dict.js;
// English may stay a lazily loaded add-on.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const loader = await read('public/i18n-dict.js');
const zhFile = await read('public/i18n-dict-zh.js');
const enFile = await read('public/i18n-dict-en.js');

// 1) The Chinese dictionary must be inline, not fetched.
// Strip the inline dictionary and all line comments first: both may legitimately
// document the old (broken) approach by name.
const loaderCode = loader
  .replace(/zh = \{[\s\S]*?\n  \};/, 'zh = {};')
  .replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(loaderCode, /document\.write/, 'i18n-dict.js must not inject the dictionary with document.write');
assert.doesNotMatch(loaderCode, /XMLHttpRequest/, 'i18n-dict.js must not use synchronous XHR (blocked on file://)');
assert.match(loader, /zh = \{/, 'the Chinese dictionary object is inline');

// 2) It must actually produce a populated ClubI18nDict when evaluated standalone.
//    This mirrors the browser executing the script with no other scripts loaded.
const ctx = {
  window: {},
  document: { currentScript: { src: 'https://example.test/public/i18n-dict.js' }, head: { appendChild() {} }, createElement: () => ({}) },
  XMLHttpRequest: undefined,
  localStorage: undefined
};
ctx.window.window = ctx.window;
vm.runInNewContext(loader, ctx, { filename: 'i18n-dict.js' });
const dict = ctx.window.ClubI18nDict;
assert.ok(dict, 'ClubI18nDict is defined');
assert.ok(dict.zh && typeof dict.zh === 'object', 'zh section exists');
const sections = Object.keys(dict.zh);
assert.ok(sections.length >= 25, `expected the full zh dictionary inline, saw ${sections.length} sections`);
assert.equal(typeof dict.zh.guide?.h1, 'string', 'guide.h1 resolves without any external request');
assert.equal(typeof dict.zh.common?.confirm, 'string', 'common.confirm resolves without any external request');
assert.equal(typeof dict.zh.donations?.listTitle, 'string', 'donations.listTitle resolves');
assert.equal(typeof dict.zh.notify?.title, 'string', 'new notify section is present');
assert.equal(typeof dict.zh.memberProfile?.title, 'string', 'new memberProfile section is present');

// 3) English is still available as a lazy add-on, and its keys line up.
assert.ok(ctx.window.ClubI18nDictLoader, 'loader API exists for lazy English');
assert.equal(ctx.window.ClubI18nDictLoader.loaded.zh, true, 'zh reports as loaded immediately');
assert.equal(ctx.window.ClubI18nDictLoader.loaded.en, false, 'en is not loaded until requested');

const enCtx = { window: {} };
enCtx.window.window = enCtx.window;
vm.runInNewContext(enFile, enCtx, { filename: 'i18n-dict-en.js' });
const en = enCtx.window.ClubI18nDictEn;
assert.ok(en, 'English bundle defines its global');
assert.equal(typeof en.guide?.h1, 'string', 'English guide.h1 exists');
assert.equal(typeof en.common?.confirm, 'string', 'English common.confirm exists');

// 4) The inline copy must match i18n-dict-zh.js (single source of truth).
//    Reuse the standalone evaluation: i18n-dict-zh.js only defines a global,
//    it does not need a document.
const zhCtx = { window: {} };
zhCtx.window.window = zhCtx.window;
vm.runInNewContext(zhFile, zhCtx, { filename: 'i18n-dict-zh.js' });
const zhDict = zhCtx.window.ClubI18nDictZh;
assert.ok(zhDict, 'i18n-dict-zh.js defines ClubI18nDictZh');
for (const section of ['guide', 'common', 'donations', 'notify', 'memberProfile']) {
  // Objects come from two different vm realms, so compare their JSON shape
  // instead of their prototypes.
  assert.equal(JSON.stringify(dict.zh[section]), JSON.stringify(zhDict[section]),
    `inline ${section} matches i18n-dict-zh.js`);
}

// 5) ClubCommon must never fall back to a raw key for its own buttons, even
//    when ClubI18n has not booted yet (the confirm dialog bug).
const common = await read('public/club-common.js');
assert.match(common, /FALLBACK_TEXT/, 'club-common has a built-in fallback table');
for (const key of ['common.confirm', 'common.cancel', 'common.undo']) {
  assert.ok(common.includes(`'${key}'`), `fallback covers ${key}`);
}
assert.match(common, /lookupDict/, 'club-common reads the dictionary directly as a fallback');

// Evaluate club-common in a context where ClubI18n is absent but the dictionary exists.
const commonCtx = {
  window: {},
  document: {
    readyState: 'complete',
    documentElement: { appendChild() {}, setAttribute() {}, style: {} },
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } }),
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => []
  },
  localStorage: { getItem: () => 'zh' },
  setTimeout, clearTimeout, console, CustomEvent: class { constructor(type) { this.type = type; } }
};
commonCtx.window.window = commonCtx.window;
commonCtx.window.ClubI18nDict = { zh: dict.zh, en: {} };
commonCtx.window.localStorage = commonCtx.localStorage;
commonCtx.window.addEventListener = () => {};
vm.runInNewContext(common, commonCtx, { filename: 'club-common.js' });
const ClubCommon = commonCtx.window.ClubCommon;
assert.ok(ClubCommon, 'ClubCommon is exposed');
assert.equal(ClubCommon.t('common.confirm'), '确定', 'confirm label resolves from the inline dictionary');
assert.equal(ClubCommon.t('common.cancel'), '取消', 'cancel label resolves');
assert.notEqual(ClubCommon.t('common.confirm'), 'common.confirm', 'never returns a raw key');

// 6) Size sanity: the inline dictionary should be roughly the zh bundle, not the
//    whole zh+en pair (English must stay lazy).
const loaderSize = (await stat(path.join(root, 'public/i18n-dict.js'))).size;
const zhSize = (await stat(path.join(root, 'public/i18n-dict-zh.js'))).size;
assert.ok(loaderSize > zhSize * 0.9, 'inline zh is present');
assert.ok(loaderSize < zhSize + 20000, 'English is not inlined (stays lazy)');

console.log(`i18n dictionary: ${sections.length} zh sections inline (${(loaderSize / 1024).toFixed(0)} KiB), `
  + 'English lazy, ClubCommon labels resolve without boot.');
