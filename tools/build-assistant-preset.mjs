import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assistantPreset} from '../public/assistant-preset.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (assistantPreset.welcome.length > 2000 || assistantPreset.system_prompt.length > 12000 || assistantPreset.suggestions.length > 8 || assistantPreset.suggestions.some(value => !value.trim() || value.length > 200)) throw new Error('Assistant preset exceeds API field bounds');
const files = new Map([
  ['docs/assistant/config-preset.json', JSON.stringify(assistantPreset, null, 2) + '\n'],
  ['docs/assistant/system-prompt.txt', assistantPreset.system_prompt + '\n']
]);
const check = process.argv.includes('--check');
for (const [name, content] of files) {
  const file = path.join(root, name);
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content) throw new Error(`Stale assistant preset: ${name}`);
    console.log(`PASS ${name} matches the preset`);
  } else {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Built ${name}`);
  }
}
