import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'docs/gomoku-experiment-validation');
fs.mkdirSync(dir, {recursive:true});
for (const candidate of ['gomokuzero', 'slowrenju']) {
  for (const baseline of ['v9thinker', 'v10', 'v10ultra']) {
    for (const [black,white] of [[candidate,baseline],[baseline,candidate]]) {
      const output = `docs/gomoku-experiment-validation/${black}-black-${white}.json`;
      if (fs.existsSync(path.join(root,output))) {
        const previous = JSON.parse(fs.readFileSync(path.join(root,output),'utf8'));
        if (previous.finishedAt) {console.log('EXISTING',black,white,previous.winner||'draw');continue;}
      }
      console.log('START',black,white,new Date().toISOString());
      await new Promise((resolve,reject) => {
        const child = spawn(process.execPath,['tools/run-gomoku-experiment-browser.mjs',black,white,output],{cwd:root,stdio:'inherit'});
        child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Match failed: ${black}/${white}: ${code}`)));
      });
    }
  }
}
await new Promise((resolve,reject) => {
  const child=spawn(process.execPath,['tools/summarize-gomoku-experiments.mjs'],{cwd:root,stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Incomplete or invalid comparison records')));
});
console.log('ALL 12 MATCHES COMPLETE');
