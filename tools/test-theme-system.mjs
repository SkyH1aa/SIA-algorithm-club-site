// Offline: node tools/test-theme-system.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const theme = await readFile(path.join(root, 'public/theme.js'), 'utf8');
const sql = await readFile(path.join(root, 'supabase/club-ui-preferences-schema.sql'), 'utf8');
const backend = await readFile(path.join(root, 'supabase/functions/club-drive/index.ts'), 'utf8');

assert.match(theme, /const MODES = \['auto', 'system', 'light', 'dark'\]/, 'system is a first-class mode');
assert.match(theme, /prefers-color-scheme: dark/, 'resolves via matchMedia');
assert.match(theme, /currentMode === 'system'/, 'only re-applies while in system mode');
assert.match(theme, /addEventListener\('change', onChange\)/, 'listens for OS theme changes');
assert.match(theme, /shortSystem/, 'switcher label exists');
assert.match(sql, /check \(theme_mode in \('auto', 'system', 'light', 'dark'\)\)/, 'SQL allows system');
assert.match(sql, /drop constraint if exists club_ui_preferences_theme_mode_check/, 'idempotent constraint migration');
assert.match(backend, /mode === 'system'/, 'backend normalises system');

// The auto (Beijing time) behaviour must be untouched.
assert.match(theme, /hour >= 6 && hour < 18 \? 'light' : 'dark'/, 'Beijing auto rule unchanged');

// --- 站点图标随主题切换 ---
// 深色用青蓝 A，日间用朱砂橙红 A（与 theme.css 的 day-paper / day-brand 一致）。
assert.match(theme, /favicon-light\.svg/, 'theme.js knows the light icon');
assert.match(theme, /function syncFavicon\(theme\)/, 'theme.js syncs the icon');
assert.match(theme, /syncFavicon\(next\);/, 'applyTheme updates the icon on every theme change');
assert.match(theme, /pendingFavicon/, 'early parse is deferred until DOM is ready');
{
  const dark = await readFile(path.join(root, 'public/favicon.svg'), 'utf8');
  const light = await readFile(path.join(root, 'public/favicon-light.svg'), 'utf8');
  // XML comments may not contain "--", which silently breaks SVG parsing.
  for (const [name, svg] of [['favicon.svg', dark], ['favicon-light.svg', light]]) {
    assert.ok(svg.startsWith('<svg'), `${name} is an SVG`);
    for (const comment of svg.match(/<!--[\s\S]*?-->/g) || []) {
      assert.ok(!comment.slice(4, -3).includes('--'), `${name} comment must not contain "--"`);
    }
  }
  assert.match(light, /#FFFDFC/, 'light icon uses the day paper background');
  assert.match(light, /#C54A34/, 'light icon uses the day brand colour');
  assert.match(dark, /#0b1220/, 'dark icon keeps the night background');
  const manifest = JSON.parse(await readFile(path.join(root, 'public/asset-versions.json'), 'utf8'));
  assert.ok(manifest.hashes['favicon.svg'], 'dark icon is content-hashed');
  assert.ok(manifest.hashes['favicon-light.svg'], 'light icon is content-hashed');
}

console.log('Theme: system mode, SQL constraint migration, backend normalisation, Beijing auto, theme-aware favicon (dark/light) preserved.');
