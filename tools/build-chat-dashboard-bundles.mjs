import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const banner = '// DASHBOARD MANUAL DEPLOYMENT BUNDLE. Generated from supabase/functions.\n// This file is standalone because the Supabase web editor does not upload _shared files.\n';
const entries = [
  ['chat', 'chat-dashboard-index.ts'],
  ['chat-api-proxy', 'chat-api-proxy-dashboard-index.ts']
];
const check = process.argv.includes('--check');
for (const [name, output] of entries) {
  const sourcePath = path.join(root, 'supabase/functions', name, 'index.ts');
  const helpers = new Map();
  function inline(file) {
    const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    return source.replace(/^import\s+[^;]+\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (statement, relative) => {
      if (!relative.startsWith('../_shared/')) throw new Error(`Unsupported import in ${file}: ${statement}`);
      const helper = path.resolve(path.dirname(file), relative);
      if (!helpers.has(helper)) {
        helpers.set(helper, '');
        helpers.set(helper, inline(helper).replace(/^export\s+(?=(?:async\s+)?(?:class|function|const|let|type|interface)\b)/gm, '').trim());
      }
      return '';
    }).trim();
  }
  const entry = inline(sourcePath);
  const result = banner + [...helpers.values(), entry].join('\n\n') + '\n';
  const destination = path.join(root, 'docs/chat-deployment', output);
  if (check) {
    if (fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n') !== result) throw new Error(`${output} is stale`);
    console.log(`PASS ${output} matches source and shared helpers`);
  } else {
    fs.writeFileSync(destination, result);
    console.log(`Built ${output}`);
  }
}

const sqlSource = fs.readFileSync(path.join(root, 'supabase/club-chat-schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const sqlDestination = path.join(root, 'docs/chat-deployment/club-chat-schema.sql');
if (check) {
  if (fs.readFileSync(sqlDestination, 'utf8').replace(/\r\n/g, '\n') !== sqlSource) throw new Error('Dashboard SQL copy is stale');
  console.log('PASS Dashboard SQL copy matches the complete main script');
} else {
  fs.writeFileSync(sqlDestination, sqlSource);
  console.log('Copied complete club-chat-schema.sql for Dashboard SQL Editor');
}
