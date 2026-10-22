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

console.log('Theme: system mode (matchMedia + change listener), SQL constraint migration, backend normalisation, Beijing auto preserved.');
