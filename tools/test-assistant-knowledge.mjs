import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, relative, dirname} from 'node:path';

// Local source audit only: no browser startup, imports of application controllers,
// authenticated data, backend, model, network request, or generated report files.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedSlugs = [
  'club-overview', 'public-guide', 'public-resources', 'public-visualization-labs',
  'public-join', 'member-login-binding', 'chat-history-attachments', 'chat-quota-guidance',
  'assistant-usage', 'checkin-operation', 'events-operation', 'points-operation',
  'store-operation', 'faq-unknown-contact'
];
const load = path => readFileSync(resolve(root, path), 'utf8');
const seed = JSON.parse(load('docs/assistant/seed.json'));
const manifest = JSON.parse(load('docs/assistant/source-manifest.json'));
const files = new Map();
for (const source of manifest.sources) {
  files.set(source.repository_file, load(source.repository_file));
  if (source.copy_repository_file) files.set(source.copy_repository_file, load(source.copy_repository_file));
}
const htmlPath = /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.html(?:#[A-Za-z0-9_-]+)?$/;
const allowedFields = ['slug', 'title', 'category', 'source_path', 'language', 'content', 'keywords'];

function auditCorpus(corpus, provenance, snapshots) {
  assert.equal(provenance.status, 'manual-draft-unpublished', 'Publication must remain manual');
  assert.match(provenance.review_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(corpus.documents.map(doc => doc.slug).sort(), [...expectedSlugs].sort(), 'Keep all 14 existing slugs');
  assert.equal(new Set(corpus.documents.map(doc => doc.slug)).size, 14);
  assert(Buffer.byteLength(JSON.stringify(corpus)) <= 2_000_000);
  const sources = new Map();
  for (const source of provenance.sources) {
    assert(!sources.has(source.id), `Duplicate source id ${source.id}`);
    sources.set(source.id, source);
    assert(!source.repository_file.includes('..') && !source.repository_file.startsWith('/'));
    assert.equal(source.source_path, '/' + source.repository_file);
    assert(!relative(root, resolve(root, source.repository_file)).startsWith('..'));
    assert(!/(?:^|\/)(?:supabase|training|.*-admin\.html)(?:\/|$)/.test(source.repository_file), 'No backend/private source');
    const text = snapshots.get(source.repository_file);
    assert.equal(typeof text, 'string', `Source missing: ${source.repository_file}`);
    assert(source.fact_scope?.length > 20, `Missing scope: ${source.id}`);
    assert(source.selectors.length || source.code_anchors?.length, `Missing concrete evidence: ${source.id}`);
    for (const selector of source.selectors) {
      const literal = selector.startsWith('#') ? `id="${selector.slice(1)}"` : selector.slice(1, -1);
      assert(text.includes(literal), `Evidence selector changed: ${source.repository_file} ${selector}`);
    }
    for (const anchor of source.code_anchors || []) {
      assert(text.includes(anchor), `Evidence code changed: ${source.repository_file} ${anchor}`);
    }
    if (source.copy_repository_file) {
      for (const key of source.translation_keys) {
        assert(snapshots.get(source.copy_repository_file)?.includes(key.split('.').at(-1) + ':'), `Copy key missing: ${key}`);
      }
    }
    for (const slug of source.document_slugs) assert(expectedSlugs.includes(slug), `Unknown provenance slug ${slug}`);
  }
  const reviews = new Map(provenance.document_reviews.map(review => [review.slug, review]));
  assert.equal(reviews.size, 14, 'Every article needs an individual review');
  for (const doc of corpus.documents) {
    assert.deepEqual(Object.keys(doc).sort(), [...allowedFields].sort(), `Import fields: ${doc.slug}`);
    assert.match(doc.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for (const [key, max] of [['title', 200], ['category', 80], ['language', 20], ['content', 50000]]) {
      assert.equal(typeof doc[key], 'string');
      assert(doc[key].trim().length && doc[key].length <= max, `${doc.slug}: ${key} length`);
    }
    assert.equal(doc.language, 'zh-CN');
    assert(htmlPath.test(doc.source_path), `Safe public HTML reference: ${doc.slug}`);
    assert(existsSync(resolve(root, doc.source_path.slice(1))), `Missing primary URL: ${doc.slug}`);
    assert(provenance.sources.some(source => source.source_path === doc.source_path && source.document_slugs.includes(doc.slug)), `Primary provenance missing: ${doc.slug}`);
    assert(Array.isArray(doc.keywords) && doc.keywords.length > 0 && doc.keywords.length <= 40);
    for (const word of doc.keywords) assert(typeof word === 'string' && word.trim() && word.length <= 100);
    assert(!/<\/?(?:script|iframe)|https?:\/\/|sb_publishable_|Bearer\s|@club\.local/i.test(doc.content), `Unexpected HTML, external URL or credential: ${doc.slug}`);
    assert(!/(?:顶栏|顶栏快捷|顶部|top.bar).{0,20}(?:签到|course shortcut)|课程签到从顶栏/i.test(doc.content), `Removed check-in shortcut: ${doc.slug}`);
    const review = reviews.get(doc.slug);
    assert(review?.conclusion && review.evidence_ids.length >= 1, `Review missing: ${doc.slug}`);
    for (const id of review.evidence_ids) {
      assert(sources.get(id)?.document_slugs.includes(doc.slug), `Unmapped evidence ${id}: ${doc.slug}`);
    }
    for (const id of review.user_decision_ids || []) {
      assert(provenance.user_decisions.some(decision => decision.id === id && decision.document_slugs.includes(doc.slug)), `Unmapped user decision ${id}`);
    }
    for (const match of doc.content.matchAll(/\/public\/[A-Za-z0-9_-]+\.html/g)) {
      assert(snapshots.has(match[0].slice(1)) || existsSync(resolve(root, match[0].slice(1))), `Broken content URL: ${match[0]}`);
    }
  }
  const text = slug => corpus.documents.find(doc => doc.slug === slug).content;
  for (const slug of ['club-overview', 'assistant-usage']) assert.match(text(slug), /新哲文院算法社.*小Bru|小Bru.*新哲文院算法社/);
  assert(provenance.user_decisions.some(decision => decision.statement.includes('小Bru') && decision.authority.includes('用户')));
  assert(!/15:45|17:10|每周二|每周四|出勤一天/.test(text('public-join')), 'Do not turn the unconfirmed static schedule into current advice');
  assert.match(text('public-join'), /不是.*实时确认/);
  assert.match(text('public-join'), /最新.*公告/);
  assert.match(text('chat-history-attachments'), /4 个附件.*5 MiB.*12 MiB/);
  assert.match(text('chat-history-attachments'), /本地保存不等于/);
  assert.match(text('chat-quota-guidance'), /自定义代理不计入现有 Chat quota\/usage/);
  assert.match(text('assistant-usage'), /与普通 AI Chat 记录分开/);
  for (const tool of ['read_member_points','read_game_leaderboard','read_published_content']) assert(text('assistant-usage').includes(tool));
  assert.match(text('assistant-usage'), /page（1–100）.*page_size（1–50）/);
  assert.match(text('assistant-usage'), /points 降序第1页.*total_score 升序第1页/);
  assert.match(text('assistant-usage'), /不遍历全部页或承诺无界全量访问/);
  assert.match(text('assistant-usage'), /当前事实必须在本轮调用工具/);
  assert.match(text('assistant-usage'), /同名不猜班级或账号/);
  assert(provenance.user_decisions.some(decision => decision.id === 'semantic-read-tools'), 'Record approved capability contract separately from page evidence');
  assert.match(text('checkin-operation'), /功能页链接不带课程参数.*兑换积分/);
  assert.match(text('checkin-operation'), /\?type=course.*预选课程签到/);
  assert.match(text('checkin-operation'), /课程签到.*无需签到码.*等待管理员审核/);
  assert.match(text('points-operation'), /个人中心.*积分榜/);
  assert.match(text('points-operation'), /没有独立的积分榜卡片/);
  assert.notEqual(corpus.documents.find(doc => doc.slug === 'checkin-operation').source_path, '/public/guide.html');
  assert(!provenance.sources.some(source => source.repository_file === 'public/guide.html'), 'Old guide prose cannot establish current operations');
  assert(provenance.conflicts.length && provenance.needs_confirmation.length);
  return true;
}

function auditNavigation(snapshots) {
  const home = snapshots.get('index.html');
  const nav = home.match(/<nav class="nav" id="nav">([\s\S]*?)<\/nav>/)?.[1];
  assert(nav, 'Homepage navigation missing');
  assert(!/member-checkin\.html/.test(nav), 'Topbar check-in changed; review navigation knowledge');
  assert(nav.includes('href="public/club-features.html"') && nav.includes('href="public/member-center.html"'));
  const features = snapshots.get('public/club-features.html');
  assert(features.includes('href="member-checkin.html"'), 'Functional check-in route changed');
  assert(!features.includes('href="member-points.html"'), 'Points card added; review points guidance');
  assert(snapshots.get('public/member-center.html').includes('href="club-features.html"'));
  assert(snapshots.get('public/member-center.html').includes('href="member-points.html"'));
  assert(snapshots.get('public/club-shell.js').includes("href: 'member-checkin.html?type=course'"));
  const checkin = snapshots.get('public/member-checkin.html');
  assert(checkin.indexOf('option value="points"') < checkin.indexOf('option value="course"'));
  assert(checkin.includes("get('type')==='course')checkinType.value='course'"));
  const labs = snapshots.get('public/visualization-lab.html');
  const labLinks = [...labs.matchAll(/<a class="choice(?: [^"]+)?" href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(labLinks.length, 8, 'Lab entry count changed; review article');
  for (const href of labLinks) assert(existsSync(resolve(root, 'public', href)), `Missing lab target ${href}`);
  for (const file of ['index.html', 'public/club-features.html', 'public/member-center.html']) {
    const html = snapshots.get(file);
    for (const match of html.matchAll(/href="([^"#?:]+\.html(?:\?[^"#]*)?(?:#[^"]*)?)"/g)) {
      const target = resolve(dirname(resolve(root, file)), match[1].split(/[?#]/)[0]);
      assert(existsSync(target), `Missing navigation target ${file}: ${match[1]}`);
    }
  }
}

auditCorpus(seed, manifest, files);
auditNavigation(files);
console.log('PASS 14 preserved slugs, import schema, safe HTML URLs, per-document reviews and evidence anchors');
console.log('PASS actual homepage/features/member-center/shell routes, check-in defaults, lab entries and local targets');

// Prove the audit rejects the original bug and missing evidence, not just JSON syntax.
for (const [name, mutate] of [
  ['removed topbar recommendation', copy => { copy.documents[9].content += '课程签到从顶栏快捷入口进入。'; }],
  ['missing article', copy => { copy.documents.pop(); }],
  ['unsafe source URL', copy => { copy.documents[0].source_path = '//external.example/a.html'; }],
  ['unconfirmed timetable', copy => { copy.documents[4].content += '15:45 到 17:10'; }],
  ['stale fixed live capability', copy => { copy.documents.find(doc => doc.slug === 'assistant-usage').content = '小Bru是新哲文院算法社助手，与普通 AI Chat 记录分开。只能读取固定前20名。'; }]
]) {
  const copy = structuredClone(seed); mutate(copy);
  assert.throws(() => auditCorpus(copy, manifest, files), undefined, `Must reject ${name}`);
}
const missing = new Map(files);
missing.set('public/club-features.html', missing.get('public/club-features.html').replace('href="member-checkin.html"', 'href="changed.html"'));
assert.throws(() => auditCorpus(seed, manifest, missing), /Evidence selector changed/);
assert.throws(() => auditNavigation(missing), /Functional check-in route changed/);
const noReview = structuredClone(manifest);
noReview.document_reviews = noReview.document_reviews.filter(item => item.slug !== 'checkin-operation');
assert.throws(() => auditCorpus(seed, noReview, files), /individual review/);
console.log('PASS 8 negative checks: stale shortcut/capability, missing article/review, external URL, unconfirmed schedule and changed route/evidence');

for (const conflict of manifest.conflicts) {
  assert(conflict.status && conflict.resolution && conflict.locations.length, `Incomplete conflict ${conflict.id}`);
  if (conflict.status === 'corrected-in-working-tree-by-page-owner') {
    if (conflict.id === 'assistant-generic-label') {
      assert(files.get('public/assistant.html').includes('小Bru'));
      assert(files.get('public/assistant-i18n.js').includes("assistant:'小Bru'"));
      assert(files.get('public/assistant-launcher.js').includes("title:'小Bru"));
    } else {
      for (const location of conflict.locations) {
        const original = files.get(location.repository_file) ?? load(location.repository_file);
        for (const anchor of location.anchors) assert(!original.includes(anchor), `Corrected copy regressed: ${location.key}`);
      }
    }
    console.log(`PASS recorded page-owner correction: ${conflict.id}`);
  } else {
    console.log(`INFO unresolved/qualified wording, not used as operation evidence: ${conflict.id}`);
  }
}
console.log('Assistant knowledge audit passed (local files only; zero network/backend/model/deployment calls).');
