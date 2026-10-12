import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matches = [
  ['v11candidate','v9'], ['v9','v11candidate'],
  ['v11candidate','v9pro'], ['v9pro','v11candidate'],
  ['v11candidate','v9thinker'], ['v9thinker','v11candidate'],
  ['v11candidate','v10'], ['v10','v11candidate']
];
for (const [black, white] of matches) {
  const output = `docs/gomoku-v11-candidate-validation/${black}-black-${white}.json`;
  console.log(`START ${black}/${white}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/run-gomoku-experiment-browser.mjs', black, white, output], { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Match failed: ${black}/${white} (${code})`)));
  });
}
console.log('ALL 8 V11 CANDIDATE MATCHES COMPLETE');
