// 给全站静态资源引用加内容哈希版本号。
//   node tools/version-static-assets.mjs          重写引用
//   node tools/version-static-assets.mjs --check  只校验，不写文件
//
// 做法：对 public/ 下需要缓存失效的文件算 sha256 前 8 位，写入
// <script src> / <link href> 的 ?v= 参数。只改查询串，不动标签其它属性。
// 幂等：重复运行结果一致；已带 ?v= 的会先被替换成最新哈希。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const check = process.argv.includes('--check');

// 只版本化这些共享资源；页面私有脚本由页面自身控制。
const VERSIONED = [
  'theme.css', 'club-ui.css', 'club-shell.js', 'theme.js', 'i18n.js', 'i18n-dict.js', 'i18n-dict-zh.js', 'i18n-dict-en.js',
  'club-common.js', 'club-share.js', 'chat-i18n.js', 'assistant-i18n.js', 'member-identity.js',
  'club-auth-storage.js', 'service-gate.js', 'service-prompts.js',
  'chat-core.js', 'chat.js', 'chat-file-bundle.js', 'chat.css', 'assistant.css',
  'vendor/supabase/supabase.min.js', 'vendor/three/three.min.js', 'vendor/three/three.module.js', 'sw.js'
];

// 行尾归一化后再算哈希。
// Windows 默认 core.autocrlf=true，本地检出是 CRLF，而 GitHub Actions 的 Linux
// 检出是 LF；直接对字节做 SHA-256 会让同一个文件在两处得到不同哈希，CI 永远失败。
// 统一转成 LF 计算，两端结果一致。
const normalizeEol = buffer => Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

const hashOf = relative => {
  const file = path.join(publicDir, relative);
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(normalizeEol(fs.readFileSync(file))).digest('hex').slice(0, 8);
};

const hashes = {};
for (const name of VERSIONED) {
  const digest = hashOf(name);
  if (digest) hashes[name] = digest;
}
// 允许引用带 ./ 前缀
const byBasename = new Map();
for (const [name, digest] of Object.entries(hashes)) byBasename.set(path.basename(name), digest);

const htmlFiles = [
  path.join(root, 'index.html'),
  // GitHub Pages 只认仓库根目录的 404.html，而不是 public/404.html。
  path.join(root, '404.html'),
  ...fs.readdirSync(publicDir).filter(name => name.endsWith('.html')).map(name => path.join(publicDir, name)),
  ...['俄罗斯方块.html', '俄罗斯方块AI.html', '贪吃蛇.html', '贪吃蛇专家系统.html']
    .map(name => path.join(root, name)).filter(file => fs.existsSync(file))
];

const stripVersion = url => url.replace(/[?&]v=[^&"']*/g, '').replace(/[?&]$/, '');
const withVersion = (url, digest) => {
  const clean = stripVersion(url);
  return `${clean}${clean.includes('?') ? '&' : '?'}v=${digest}`;
};

const apply = (source, isRoot) => {
  let changed = 0;
  // <script src="..."></script>
  source = source.replace(/(<script\b[^>]*\bsrc=")([^"]+)("[^>]*>)/g, (whole, pre, url, post) => {
    const rel = stripVersion(url);
    const normalized = rel.replace(/^\.\//, '').replace(/^public\//, '');
    const name = normalized.split('/').length > 1 ? normalized : path.basename(normalized);
    const digest = hashes[name] || byBasename.get(path.basename(normalized));
    if (!digest) return whole;
    const next = withVersion(url, digest);
    if (next !== url) { changed++; return `${pre}${next}${post}`; }
    return whole;
  });
  // <link href="...">
  source = source.replace(/(<link\b[^>]*\bhref=")([^"]+)("[^>]*>)/g, (whole, pre, url, post) => {
    const rel = stripVersion(url);
    if (!/\.css(?:$|\?)/.test(rel)) return whole;
    const normalized = rel.replace(/^\.\//, '').replace(/^public\//, '');
    const name = normalized.split('/').length > 1 ? normalized : path.basename(normalized);
    const digest = hashes[name] || byBasename.get(path.basename(normalized));
    if (!digest) return whole;
    const next = withVersion(url, digest);
    if (next !== url) { changed++; return `${pre}${next}${post}`; }
    return whole;
  });
  return { source, changed };
};

let total = 0;
const stale = [];
for (const file of htmlFiles) {
  const before = fs.readFileSync(file, 'utf8');
  const { source, changed } = apply(before, file === path.join(root, 'index.html'));
  if (source !== before) {
    if (check) stale.push(path.relative(root, file));
    else fs.writeFileSync(file, source, 'utf8');
  }
  total += changed;
}

const manifestFile = path.join(publicDir, 'asset-versions.json');
if (check) {
  const recorded = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
  const sameManifest = recorded && JSON.stringify(recorded.hashes) === JSON.stringify(hashes);
  if (stale.length || !sameManifest) {
    console.error('FAIL static asset versions are stale:');
    for (const file of stale) console.error(`  - ${file}`);
    if (!sameManifest) console.error('  - public/asset-versions.json does not match file hashes');
    process.exit(1);
  }
  console.log(`PASS all HTML references use current content hashes (${Object.keys(hashes).length} assets).`);
} else {
  fs.writeFileSync(manifestFile, `${JSON.stringify({ generated_by: 'tools/version-static-assets.mjs', hashes }, null, 2)}\n`, 'utf8');
  console.log(`Updated ${total} references across ${htmlFiles.length} HTML files; ${Object.keys(hashes).length} assets hashed.`);
}
