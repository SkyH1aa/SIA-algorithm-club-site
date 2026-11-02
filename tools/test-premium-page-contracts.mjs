import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const contract = JSON.parse(fs.readFileSync(path.join(root, 'docs/premium-upgrade-2026-11/source-contracts.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stripVersion = value => value.replace(/([?&])v=[^&"'\s<>)]*(&?)/g, (_, prefix, suffix) => suffix ? prefix : '');
const failures = [];
for (const page of contract.pages) {
  const source = fs.readFileSync(path.join(root, page.path), 'utf8').replace(/\r/g, '');
  const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/i.test(match[1]))
    .map(match => hash(stripVersion(match[2])));
  for (const original of page.inlineScripts) {
    const index = scripts.indexOf(original);
    if (index < 0) failures.push(`${page.path}: original inline script changed (${original.slice(0, 12)})`);
    else scripts.splice(index, 1);
  }
  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  for (const id of page.ids) if (!ids.includes(id)) failures.push(`${page.path}: original ID removed: ${id}`);
  const hrefs = [...source.matchAll(/\bhref="([^"]+)"/g)].map(match => stripVersion(match[1]));
  for (const original of page.hrefs) {
    const index = hrefs.indexOf(stripVersion(original));
    if (index < 0) failures.push(`${page.path}: original URL removed: ${original}`);
    else hrefs.splice(index, 1);
  }
}
for (const frozen of contract.frozen) {
  if (hash(fs.readFileSync(path.join(root, frozen.path))) !== frozen.sha256) failures.push(`${frozen.path}: frozen dependency changed`);
}
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`PASS premium page contracts: ${contract.pages.length} original inline-script/ID/link contracts and ${contract.frozen.length} frozen dependencies preserved.`);
