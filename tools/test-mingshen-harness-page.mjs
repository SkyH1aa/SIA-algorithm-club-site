// Offline: node tools/test-mingshen-harness-page.mjs
// Execute the actual page script, not a copied URL validator, with no network,
// browser, dependencies or real eight-second wait. All source files are read-only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
const [html, source, chat, zhSource, enSource, css, shell] = await Promise.all([
  'public/mingshen-harness.html', 'public/mingshen-harness.js', 'public/chat.html',
  'public/i18n-dict-zh.js', 'public/i18n-dict-en.js',
  'public/mingshen-harness.css', 'public/club-shell.js'
].map(read));
const repository = 'https://github.com/SkyH1aa/MingshenHarness';
const fallbackKey = 'harness.downloadFallback';
const readyKey = 'harness.downloadReady';

const dictionaries = { window: {} };
vm.runInNewContext(zhSource, dictionaries, { filename: 'i18n-dict-zh.js', timeout: 1000 });
vm.runInNewContext(enSource, dictionaries, { filename: 'i18n-dict-en.js', timeout: 1000 });
const dict = { zh: dictionaries.window.ClubI18nDictZh, en: dictionaries.window.ClubI18nDictEn };
const lookup = (lang, key) => key.split('.').reduce((value, part) => value?.[part], dict[lang]);

// A small, dependency-free structural reader for these static HTML fixtures.
// Keep parent links: comparing text offsets alone cannot prove that an entry is
// outside a nested/hidden workspace. Ignore comments and script/style contents.
function elements(markup) {
  const clean = markup.replace(/<!--[\s\S]*?-->/g, '').replace(
    /(<(?:script|style)\b[^>]*>)[\s\S]*?(<\/(?:script|style)\s*>)/gi, '$1$2');
  const nodes = [], stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of clean.matchAll(/<(\/?)([a-z][a-z0-9:-]*)\b([^>]*)>/gi)) {
    const [, closing, rawTag, rawAttrs] = match;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index >= 0) {
        stack[index].text = clean.slice(stack[index].contentStart, match.index);
        stack.length = index;
      }
      continue;
    }
    const attrs = {};
    for (const attr of rawAttrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    }
    const node = { tag, attrs, parent: stack.at(-1), contentStart: match.index + match[0].length, text: '' };
    nodes.push(node);
    if (!voidTags.has(tag) && !/\/\s*$/.test(rawAttrs)) stack.push(node);
  }
  return nodes;
}
const has = (node, key) => Object.hasOwn(node.attrs, key);
const pageNodes = elements(html);
const downloads = pageNodes.filter(node => has(node, 'data-harness-download'));
const statuses = pageNodes.filter(node => has(node, 'data-download-status'));
assert.ok(downloads.length >= 2, 'hero and footer both need download anchors');
assert.equal(statuses.length, 1, 'one live download status is required');
assert.equal(statuses[0].attrs.role, 'status');
assert.equal(statuses[0].attrs['data-i18n'], fallbackKey);
assert.ok(statuses[0].text.trim(), 'status must remain readable without JavaScript/i18n');
function safeNewTab(node, label) {
  assert.equal(node.tag, 'a', label + ': use a real anchor');
  assert.equal(node.attrs.target, '_blank', label + ': open a new tab');
  const rel = new Set((node.attrs.rel ?? '').toLowerCase().split(/\s+/));
  for (const token of ['noopener', 'noreferrer']) assert.ok(rel.has(token), label + ': missing ' + token);
}
for (const node of downloads) {
  assert.equal(node.attrs.href, repository, 'static download href must work without JavaScript');
  assert.equal(has(node, 'download'), false, 'download must require a user navigation, not an automatic download');
  safeNewTab(node, 'download');
}
for (const node of pageNodes.filter(node => node.tag === 'a' && node.attrs.target === '_blank')) {
  safeNewTab(node, node.attrs.href);
}
assert.ok(pageNodes.some(node => node.tag === 'script' &&
  node.attrs.src?.split('?')[0] === 'mingshen-harness.js'), 'HTML must load the script under test');

// Integration contracts, not a second motion lifecycle harness: the companion
// test-mingshen-harness-motion.mjs owns WAAPI/observers/preferences/cancellation.
const hasClass = (node, name) => (node.attrs.class ?? '').split(/\s+/).includes(name);
const within = (node, parent) => node === parent || Boolean(node.parent && within(node.parent, parent));
const uniqueId = id => {
  assert.ok(id, 'referenced IDs must not be empty');
  const matches = pageNodes.filter(node => node.attrs.id === id);
  assert.equal(matches.length, 1, id + ': exactly one actual HTML target');
  return matches[0];
};
const tablists = pageNodes.filter(node => has(node, 'data-club-tabs'));
assert.equal(tablists.length, 4, 'screenshots, flow, code and docs each use the shared shell');
assert.deepEqual(pageNodes.filter(node => node.attrs.role === 'tablist'), tablists, 'no separate unowned tablists');
assert.deepEqual(pageNodes.filter(node => has(node, 'data-harness-tabs')), tablists, 'each shared group exposes the product feedback hook');
const groupSpecs = [
  { name: 'screenshots', label: 'viewTabs', panelClass: 'harness-view-panel',
    tabKeys: ['viewOverview', 'viewProjects', 'viewInput'],
    targetIds: ['harnessViewOverview', 'harnessViewProjects', 'harnessViewInput'] },
  { name: 'flow', label: 'flowTabs', panelClass: 'harness-demo-panel', states: ['plan', 'work', 'review'],
    tabKeys: ['flowPlan', 'flowWork', 'flowReview'],
    targetIds: ['harnessFlowPlan', 'harnessFlowWork', 'harnessFlowReview'],
    panelKeys: [['planTitle', 'planDetail', 'planArtifact'], ['workTitle', 'workDetail', 'workArtifact'],
      ['reviewTitle', 'reviewDetail', 'reviewArtifactLine']] },
  { name: 'code', label: 'codeTabs', panelClass: 'harness-demo-panel', states: ['context', 'diff', 'restore'],
    tabKeys: ['codeContext', 'codeDiff', 'codeRestore'],
    targetIds: ['harnessCodeContext', 'harnessCodeDiff', 'harnessCodeRestore'],
    panelKeys: [['contextTitle', 'contextDetail'], ['diffTitle', 'diffDetail'], ['restoreTitle', 'restoreDetail']] },
  { name: 'docs', label: 'docsTabs', panelClass: 'harness-demo-panel', states: ['read', 'compose', 'export'],
    tabKeys: ['docsRead', 'docsCompose', 'docsExport'],
    targetIds: ['harnessDocsRead', 'harnessDocsCompose', 'harnessDocsExport'],
    panelKeys: [['readTitle', 'readDetail'], ['composeTitle', 'composeDetail'], ['exportTitle', 'exportDetail']] }
];
const tabGroups = groupSpecs.map(spec => {
  const matches = tablists.filter(node => node.attrs['data-i18n-aria'] === 'harness.' + spec.label);
  assert.equal(matches.length, 1, spec.name + ': one distinct translated tablist name');
  const tablist = matches[0];
  assert.equal(tablist.attrs.role, 'tablist');
  assert.notEqual(tablist.attrs['data-club-tabs'], 'filter', spec.name + ': switch actual panels, not group filters');
  assert.ok(tablist.attrs['aria-label']?.trim(), spec.name + ': static accessible name before i18n');
  assert.equal(has(tablist, 'data-club-tabs-ready'), false, spec.name + ': only shell initialization reveals controls');
  assert.ok(hasClass(tablist, spec.name === 'screenshots' ? 'harness-view-tabs' : 'harness-explorer-tabs'),
    spec.name + ': use progressive enhancement CSS');
  const indicators = pageNodes.filter(node => hasClass(node, 'harness-tab-indicator') && within(node, tablist));
  assert.equal(indicators.length, 1, spec.name + ': one product selection indicator');
  assert.equal(indicators[0].parent, tablist, spec.name + ': indicator is a direct tablist child');
  assert.equal(indicators[0].tag, 'span');
  assert.equal(indicators[0].attrs['aria-hidden'], 'true', spec.name + ': decorative indicator stays out of the accessibility tree');
  const tabs = pageNodes.filter(node => node.attrs.role === 'tab' && within(node, tablist));
  const shellButtons = pageNodes.filter(node => within(node, tablist) &&
    (node.attrs.role === 'tab' || (node.tag === 'button' && has(node, 'data-tab-target'))));
  assert.deepEqual(shellButtons, tabs, spec.name + ': shell must not bind extra unnamed/non-tab controls');
  assert.equal(tabs.length, 3, spec.name + ': three distinct views');
  assert.deepEqual(tabs.map(node => node.attrs['data-i18n']), spec.tabKeys.map(key => 'harness.' + key));
  assert.deepEqual(tabs.map(node => node.attrs['data-tab-target']), spec.targetIds, spec.name + ': stable actual panel targets');
  const explorers = spec.states ? pageNodes.filter(node => node.attrs['data-harness-explorer'] === spec.name) : [];
  if (spec.states) assert.equal(explorers.length, 1, spec.name + ': one semantic explorer owner');
  const owner = explorers[0] ?? pageNodes.find(node => has(node, 'data-harness-stage'));
  assert.ok(owner && within(tablist, owner), spec.name + ': controls belong to their own content');
  if (spec.states) assert.equal(owner.attrs['data-harness-active'], spec.states[0], spec.name + ': no-JS artwork matches first panel');
  const targets = tabs.map((tab, index) => {
    const label = spec.name + ' / ' + spec.targetIds[index];
    assert.equal(tab.tag, 'button', label + ': native keyboard-activatable tab');
    assert.equal(tab.attrs.type, 'button');
    assert.equal(has(tab, 'disabled'), false, label + ': tab must be operable');
    assert.equal(uniqueId(tab.attrs.id), tab, label + ': unique control ID');
    const target = tab.attrs['data-tab-target'];
    assert.equal(tab.attrs['aria-controls'], target, label + ': ARIA and shell target agree');
    const panel = uniqueId(target);
    assert.ok(hasClass(panel, spec.panelClass) && within(panel, owner), label + ': real panel in its own group');
    assert.equal(panel.attrs.role, 'tabpanel');
    assert.equal(panel.attrs['aria-labelledby'], tab.attrs.id, label + ': reciprocal tab/panel labelling');
    assert.equal(panel.attrs.tabindex, '0', label + ': panel is keyboard reachable');
    assert.ok(tab.text.trim(), label + ': readable tab before i18n');
    assert.equal(tab.attrs['aria-selected'], String(index === 0), label + ': only first tab starts selected');
    assert.equal(Number(tab.attrs.tabindex ?? 0), index === 0 ? 0 : -1, label + ': static roving tab order');
    assert.equal(has(panel, 'hidden'), index !== 0, label + ': first content survives without JS; others start hidden');
    if (spec.states) {
      assert.equal(panel.attrs['data-harness-state'], spec.states[index], label + ': independent artwork state');
      for (const key of spec.panelKeys[index]) {
        const content = pageNodes.filter(node => within(node, panel) && node.attrs['data-i18n'] === 'harness.' + key);
        assert.equal(content.length, 1, label + ': translated content ' + key);
        assert.ok(content[0].text.trim(), label + ': readable fallback for ' + key);
      }
      assert.equal(pageNodes.filter(node => node.tag === 'h3' && within(node, panel)).length, 1, label + ': meaningful panel heading');
      assert.ok(pageNodes.some(node => node.tag === 'p' && within(node, panel) && node.text.trim()), label + ': actual explanatory content');
    }
    return panel;
  });
  return { ...spec, tablist, tabs, targets };
});
const allTabs = tabGroups.flatMap(group => group.tabs);
const allTargets = tabGroups.flatMap(group => group.targets);
assert.equal(new Set(allTabs).size, 12, 'each group owns distinct controls');
assert.equal(new Set(allTargets).size, 12, 'no panel target aliases within or across groups');
assert.deepEqual(pageNodes.filter(node => node.attrs.role === 'tab'), allTabs, 'no orphan tab controls');
assert.deepEqual(pageNodes.filter(node => node.attrs.role === 'tabpanel'), allTargets, 'no orphan ARIA panels');
assert.deepEqual(pageNodes.filter(node => hasClass(node, 'harness-view-panel') || hasClass(node, 'harness-demo-panel')),
  allTargets, 'every product panel is managed by exactly one shared group');
const { targets } = tabGroups[0];
for (const panel of targets) {
  const images = pageNodes.filter(node => node.tag === 'img' && within(node, panel));
  assert.equal(images.length, 1, panel.attrs.id + ': show an actual screenshot');
  const image = images[0];
  assert.ok(image.attrs.alt?.trim(), panel.attrs.id + ': static image description');
  assert.match(image.attrs.src, /^assets\/mingshen-harness\//, 'use the product screenshot asset');
  assert.ok(Number(image.attrs.width) > 0 && Number(image.attrs.height) > 0, 'reserve screenshot geometry');
  assert.equal(image.parent.tag, 'a');
  assert.equal(image.parent.attrs.href, image.attrs.src, 'screenshot link opens the displayed original');
}
for (const group of tabGroups) {
  for (const target of [group.tablist, ...group.targets]) {
    for (let ancestor = target; ancestor; ancestor = ancestor.parent) {
      if (ancestor !== target || target === group.targets[0] || target === group.tablist) {
        assert.equal(has(ancestor, 'hidden'), false, group.name + ': no ancestor conceals controls or initial content');
      }
      assert.notEqual(ancestor.attrs['aria-hidden'], 'true', group.name + ': controls and text stay accessible');
      assert.equal(has(ancestor, 'inert'), false, group.name + ': no inert panel/control wrapper');
    }
  }
}
const overview = targets[0];
const body = pageNodes.find(node => node.tag === 'body');
assert.ok(hasClass(body, 'club-page') && hasClass(body, 'harness-page'), 'shared shell and product motion need their body hooks');
for (let node = overview; node; node = node.parent) {
  assert.equal(has(node, 'hidden'), false, 'overview must not inherit a static hidden gate');
  assert.notEqual(node.attrs['aria-hidden'], 'true', 'overview must remain accessible without JS');
  assert.equal(has(node, 'data-reveal'), false, 'shared reveal must not hide the screenshot stage');
  assert.doesNotMatch(node.attrs.style ?? '', /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s|;|$))/, 'no inline no-JS concealment');
}
const stage = pageNodes.filter(node => has(node, 'data-harness-stage'));
const screen = pageNodes.filter(node => has(node, 'data-harness-screen'));
const flow = pageNodes.filter(node => has(node, 'data-harness-flow'));
assert.equal(stage.length, 1, 'one semantic screenshot stage');
assert.equal(screen.length, 1, 'one inner screen owns scroll transforms');
assert.equal(flow.length, 1, 'one semantic workflow');
assert.ok(targets.every(panel => within(panel, stage[0])), 'all tab targets belong to the real showcase');
assert.ok(within(screen[0], overview) && screen[0] !== overview, 'transform only the dedicated inner overview screen');
const productTargets = pageNodes.filter(node => has(node, 'data-harness-stage') || has(node, 'data-harness-screen') ||
  has(node, 'data-harness-flow') || ['harness-hero-word', 'harness-hero-copy', 'harness-hero-track',
    'harness-view-panel', 'harness-flow-line', 'harness-flow-step'].some(name => hasClass(node, name)));
const reveals = pageNodes.filter(node => has(node, 'data-reveal'));
assert.ok(reveals.length, 'shared shell still owns the generic copy reveals');
for (const target of productTargets) {
  assert.ok(!reveals.some(reveal => within(target, reveal) || within(reveal, target)),
    'shared reveal and product choreography must not compete on nested wrappers');
}

const scripts = pageNodes.filter(node => node.tag === 'script');
function pageScript(file) {
  const matches = scripts.filter(node => node.attrs.src?.split('?')[0] === file);
  assert.equal(matches.length, 1, file + ': load once as a separate script');
  const node = matches[0];
  assert.equal(node.parent, body, file + ': keep at the end of the body');
  for (const attr of ['async', 'defer', 'type']) assert.equal(has(node, attr), false, file + ': preserve ordered classic-script startup');
  return scripts.indexOf(node);
}
const loaderIndex = pageScript('mingshen-harness.js');
const shellIndex = pageScript('club-shell.js');
const interactionsIndex = pageScript('mingshen-harness-interactions.js');
const motionIndex = pageScript('mingshen-harness-motion.js');
assert.ok(loaderIndex < shellIndex && shellIndex < interactionsIndex && interactionsIndex < motionIndex,
  'ordered startup: independent download loader, shared shell, product interactions, then motion');
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
assert.equal(inlineScripts.length, 0, 'do not duplicate tab/motion/download logic inline');
const stylesheets = pageNodes.filter(node => node.tag === 'link' && node.attrs.rel === 'stylesheet')
  .map(node => node.attrs.href?.split('?')[0]);
assert.equal(stylesheets.filter(file => file === 'mingshen-harness.css').length, 1, 'load product CSS once');
assert.ok(stylesheets.includes('club-ui.css') && stylesheets.indexOf('club-ui.css') < stylesheets.indexOf('mingshen-harness.css'),
  'product CSS ownership overrides must load after shared animation defaults');
assert.doesNotMatch(source, /data-club-tabs|data-tab-target|club:tabchange|\.animate\s*\(|IntersectionObserver/,
  'the independently tested download loader must not take ownership of tabs or animation');

// Read the authored CSS contracts only; this is not a browser/cascade emulator.
const cleanCSS = css.replace(/\/\*[\s\S]*?\*\//g, '');
// Base rules precede responsive/preference blocks in this authored stylesheet.
function cssRule(selector, inCSS = cleanCSS.slice(0, cleanCSS.indexOf('@media'))) {
  const matches = [...inCSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].trim() === selector);
  assert.equal(matches.length, 1, 'missing or ambiguous CSS contract: ' + selector);
  return matches[0][2];
}
const pageScope = 'body.club-page.harness-page ';
assert.match(cssRule(pageScope + '.harness-main > *'), /\banimation\s*:\s*none\s*;/, 'disable shared automatic chapter entrances in favor of authored choreography');
assert.match(cssRule(pageScope + '.harness-view-panel'), /\banimation\s*:\s*none\s*;/, 'tab feedback must not overlap CSS panel entrances');
assert.match(cssRule(pageScope + '.harness-view-panel[hidden]'), /\bdisplay\s*:\s*none\s*!important\s*;/, 'shell hidden state wins over panel layout');
assert.match(cssRule(pageScope + '.harness-view-tabs'), /\bdisplay\s*:\s*none\s*;/, 'hide nonfunctional controls when JS is absent');
assert.match(cssRule(pageScope + '.harness-view-tabs[data-club-tabs-ready]'), /\bdisplay\s*:\s*flex\s*;/, 'show controls only after shell activation');
assert.match(cssRule(pageScope + '.harness-explorer-tabs'), /\bdisplay\s*:\s*none\s*;/, 'explorer controls also stay hidden without JS');
assert.match(cssRule(pageScope + '.harness-explorer-tabs[data-club-tabs-ready]'), /\bdisplay\s*:\s*flex\s*;/, 'explorers reveal only after shared shell activation');
assert.match(cssRule(pageScope + '.harness-demo-panel[hidden]'), /\bdisplay\s*:\s*none\s*!important\s*;/, 'hidden explorer panels cannot be exposed by component layout');
assert.doesNotMatch(cleanCSS, /@keyframes\b/, 'product CSS must not add another animation owner');
for (const declaration of cleanCSS.matchAll(/\banimation(?:-name)?\s*:\s*([^;}]+)/g)) {
  assert.equal(declaration[1].trim(), 'none', 'product CSS must not add another animation owner');
}
const reducedStart = cleanCSS.indexOf('@media (prefers-reduced-motion: reduce)');
assert.ok(reducedStart >= 0, 'product CSS needs an explicit reduced-motion fallback');
const reducedOpen = cleanCSS.indexOf('{', reducedStart);
let reducedEnd = reducedOpen + 1, depth = 1;
for (; reducedEnd < cleanCSS.length && depth; reducedEnd++) {
  if (cleanCSS[reducedEnd] === '{') depth++;
  if (cleanCSS[reducedEnd] === '}') depth--;
}
assert.equal(depth, 0, 'reduced-motion block must be closed');
const reducedCSS = cleanCSS.slice(reducedOpen + 1, reducedEnd - 1);
assert.match(cssRule(pageScope + '.harness-screen', reducedCSS), /\btransform\s*:\s*none\s*;/);
assert.match(cssRule(pageScope + '.harness-button:hover svg', reducedCSS), /\btransform\s*:\s*none\s*;/);
assert.match(cssRule(pageScope + ':is(.harness-button, .harness-button svg, .harness-view-tabs button)', reducedCSS),
  /\btransition\s*:\s*none\s*;/, 'reduced motion includes tab and button feedback');

// As in test-admin-hub.mjs, extract the unchanged production setupTabs function.
// Supply only DOM mechanics here, never a copied implementation of tab behavior.
const tabsStart = shell.indexOf('  function setupTabs(scope) {');
const tabsEnd = shell.indexOf('\n  // 外部可在数据加载完成后', tabsStart);
assert.ok(tabsStart >= 0 && tabsEnd > tabsStart, 'locate the real shared shell setupTabs');
function shellTabsFixture() {
  let document;
  const fixtures = new Map();
  for (const node of pageNodes) {
    const attrs = { ...node.attrs }, listeners = new Map();
    const element = {
      attrs, listeners, parentElement: null,
      dataset: new Proxy({}, {
        get: (_, key) => attrs['data-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())],
        set: (_, key, value) => { attrs['data-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())] = String(value); return true; }
      }),
      get hidden() { return Object.hasOwn(attrs, 'hidden'); },
      set hidden(value) { if (value) attrs.hidden = ''; else delete attrs.hidden; },
      get tabIndex() { return Number(attrs.tabindex ?? (node.tag === 'button' ? 0 : -1)); },
      set tabIndex(value) { attrs.tabindex = String(value); },
      getAttribute: name => attrs[name] ?? null,
      setAttribute(name, value) { attrs[name] = String(value); },
      querySelectorAll(selector) {
        assert.ok(['[data-club-tabs]', '[role="tab"], button[data-tab-target]'].includes(selector), 'unexpected shell selector: ' + selector);
        return pageNodes.filter(candidate => candidate !== node && within(candidate, node) &&
          (selector === '[data-club-tabs]' ? has(candidate, 'data-club-tabs') :
            candidate.attrs.role === 'tab' || (candidate.tag === 'button' && has(candidate, 'data-tab-target'))))
          .map(candidate => fixtures.get(candidate));
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent(event) {
        event.target ??= this;
        for (let current = this; current; current = current.parentElement) {
          for (const fn of current.listeners.get(event.type) ?? []) fn(event);
          if (!event.bubbles) break;
        }
        return !event.defaultPrevented;
      },
      focus() { assert.equal(this.hidden, false, 'cannot focus a hidden tab'); document.activeElement = this; },
      click() { this.dispatchEvent({ type: 'click', bubbles: true }); }
    };
    fixtures.set(node, element);
  }
  for (const [node, element] of fixtures) element.parentElement = fixtures.get(node.parent) ?? null;
  document = {
    activeElement: fixtures.get(body),
    getElementById: id => fixtures.get(pageNodes.find(node => node.attrs.id === id)) ?? null,
    querySelectorAll(selector) {
      assert.equal(selector, '[data-club-tabs]');
      return tablists.map(node => fixtures.get(node));
    }
  };
  const context = vm.createContext({ document, CustomEvent: class {
    constructor(type, options) { this.type = type; Object.assign(this, options); }
  } });
  vm.runInContext(shell.slice(tabsStart, tabsEnd), context, { filename: 'club-shell.js:setupTabs', timeout: 1000 });
  return { document, setup: (scope = document) => context.setupTabs(scope), body: fixtures.get(body),
    groups: tabGroups.map(group => ({ ...group, tablist: fixtures.get(group.tablist),
      tabs: group.tabs.map(node => fixtures.get(node)), panels: group.targets.map(node => fixtures.get(node)) })) };
}
const shellUI = shellTabsFixture();
function assertActive(group, index, label) {
  assert.equal(group.tablist.dataset.activeTab, group.targetIds[index], label + ': active target');
  for (let candidate = 0; candidate < group.tabs.length; candidate++) {
    const selected = candidate === index;
    assert.equal(group.panels[candidate].hidden, !selected, label + ': exactly one visible panel');
    assert.equal(group.tabs[candidate].getAttribute('aria-selected'), String(selected), label + ': selection ARIA');
    assert.equal(group.tabs[candidate].tabIndex, selected ? 0 : -1, label + ': roving tabindex');
  }
}
const tabEvents = [], groupEvents = new Map(shellUI.groups.map(group => [group, []]));
for (const group of shellUI.groups) {
  group.tablist.addEventListener('club:tabchange', event => {
    assert.equal(event.target, group.tablist, group.name + ': no other group event arrives at this tablist');
    groupEvents.get(group).push(event);
  });
}
shellUI.body.addEventListener('club:tabchange', event => {
  const group = shellUI.groups.find(candidate => candidate.tablist === event.target);
  assert.ok(group, 'event bubbles from one actual HTML tablist to body consumers');
  assert.equal(event.bubbles, true, group.name + ': shared event must bubble');
  const selected = group.targetIds.indexOf(event.detail.target);
  assert.ok(selected >= 0, group.name + ': event names a real target owned by its emitter');
  assertActive(group, selected, group.name + ': state committed before body observers');
  assert.equal(groupEvents.get(group).at(-1), event, group.name + ': same event reaches local and body observers');
  tabEvents.push(event);
});
shellUI.setup();
assert.equal(tabEvents.length, 4, 'exactly one initial activation per group');
assert.equal(shellUI.document.activeElement, shellUI.body, 'initializing all four groups does not steal focus');
for (const group of shellUI.groups) {
  assertActive(group, 0, group.name + ': shared shell startup');
  assert.equal(group.tablist.dataset.clubTabsReady, 'true', group.name + ': reveal controls after shared setup');
  assert.equal(groupEvents.get(group).length, 1, group.name + ': exactly one own startup event');
  for (const panel of group.panels) assert.equal(panel.getAttribute('data-club-tabpanel'), '', group.name + ': mark every real target');
  for (const tab of group.tabs) {
    assert.equal(tab.listeners.get('click')?.length, 1, group.name + ': one production click listener');
    assert.equal(tab.listeners.get('keydown')?.length, 1, group.name + ': one production key listener');
  }
}
function snapshot(group) {
  return {
    attrs: [group.tablist, ...group.tabs, ...group.panels].map(node => ({ ...node.attrs })),
    listeners: [group.tablist, ...group.tabs].map(node => [...node.listeners].map(([type, callbacks]) => [type, callbacks.length])),
    events: groupEvents.get(group).length
  };
}
function assertIdempotent(label) {
  const before = shellUI.groups.map(snapshot), count = tabEvents.length, focus = shellUI.document.activeElement;
  shellUI.setup();
  for (const group of shellUI.groups) shellUI.setup(group.tablist.parentElement);
  assert.deepEqual(shellUI.groups.map(snapshot), before, label + ': document and scoped setup preserve state and listeners');
  assert.equal(tabEvents.length, count, label + ': no reinitialization events');
  assert.equal(shellUI.document.activeElement, focus, label + ': no focus theft');
}
assertIdempotent('initial repeated setup');
function activate(group, index, action, count, label, focus = shellUI.document.activeElement) {
  const others = shellUI.groups.filter(candidate => candidate !== group);
  const beforeOthers = others.map(snapshot), before = tabEvents.length, beforeOwn = groupEvents.get(group).length;
  action();
  assertActive(group, index, group.name + ': ' + label);
  assert.deepEqual(others.map(snapshot), beforeOthers, group.name + ': ' + label + ' leaves all sibling groups untouched');
  assert.equal(tabEvents.length, before + count, group.name + ': ' + label + ' emits exactly the expected number of body events');
  assert.equal(groupEvents.get(group).length, beforeOwn + count, group.name + ': ' + label + ' emits only on its own tablist');
  assert.equal(shellUI.document.activeElement, focus, group.name + ': ' + label + ' preserves or transfers focus correctly');
}
function clickTab(group, index) {
  const changed = group.tablist.dataset.activeTab !== group.targetIds[index];
  // HTMLElement.click() does not itself focus; verify that shell activation does
  // not steal focus from another group. Real pointer focusing is browser-owned.
  activate(group, index, () => group.tabs[index].click(), changed ? 1 : 0, 'click ' + index);
}
// Start with deliberately different selections so accidental global resets or
// global key handling cannot pass just because every other group is at index 0.
for (const [index, group] of shellUI.groups.entries()) clickTab(group, (index + 1) % group.tabs.length);
assertIdempotent('setup after independent selections');
for (const group of shellUI.groups) {
  for (const [index, tab] of group.tabs.entries()) {
    clickTab(group, index);
    activate(group, index, () => tab.click(), 0, 'active click never replays feedback');
  }
  for (const [index, tab] of group.tabs.entries()) {
    for (const [key, selected] of [['ArrowRight', (index + 1) % group.tabs.length],
      ['ArrowLeft', (index - 1 + group.tabs.length) % group.tabs.length], ['Home', 0], ['End', group.tabs.length - 1]]) {
      clickTab(group, index);
      tab.focus();
      const event = { type: 'keydown', key, bubbles: true, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; } };
      activate(group, selected, () => tab.dispatchEvent(event), 1, key + ' from ' + index, group.tabs[selected]);
      assert.equal(event.defaultPrevented, true, group.name + ': ' + key + ' consumes navigation');
    }
  }
  const focusedTab = shellUI.document.activeElement;
  const selected = group.tabs.indexOf(focusedTab);
  assert.ok(selected >= 0, group.name + ': keyboard focus stays inside its group');
  for (const [key, shiftKey] of [['Tab', false], ['Tab', true], ['Escape', false], ['ArrowDown', false], ['a', false]]) {
    const event = { type: 'keydown', key, shiftKey, bubbles: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    activate(group, selected, () => focusedTab.dispatchEvent(event), 0, key + (shiftKey ? ' (Shift)' : '') + ' is unhandled');
    assert.equal(event.defaultPrevented, false, group.name + ': ' + key + ' is not trapped');
  }
  // Exercise the shell promise to repair all visibility, including a panel made
  // visible by another renderer, instead of hiding only the previous selection.
  const destination = (selected + 1) % group.tabs.length;
  for (const panel of group.panels) panel.hidden = false;
  clickTab(group, destination);
  assertIdempotent(group.name + ': setup after keyboard and visibility repair');
}
console.log('Harness integration: 4 independent shared tablists / 12 real panels, reciprocal ARIA and no-JS content, ordered separate scripts, CSS ownership/reduced motion, real setupTabs clicks/arrows/Home/End/focus/bubbling events/scoped idempotency passed (no browser).');

const usedKeys = new Set(pageNodes.flatMap(node => Object.entries(node.attrs)
  .filter(([name]) => name.startsWith('data-i18n'))
  .flatMap(([, value]) => [...value.matchAll(/\bharness\.[A-Za-z][A-Za-z0-9_.]*/g)].map(match => match[0]))));
assert.ok(usedKeys.has('harness.pageTitle'), 'cover document title translation');
assert.ok(usedKeys.has('harness.openScreenshot'), 'cover aria translation');
assert.ok(usedKeys.has('harness.screenshotAlt'), 'cover attribute translation');
for (const match of source.matchAll(/\bharness\.[A-Za-z][A-Za-z0-9_.]*/g)) usedKeys.add(match[0]);
for (const key of usedKeys) {
  for (const lang of ['zh', 'en']) {
    const text = lookup(lang, key);
    assert.equal(typeof text, 'string', lang + ': missing ' + key);
    assert.ok(text.trim() && text !== key, lang + ': empty/raw-key translation ' + key);
  }
}

const chatNodes = elements(chat);
assert.ok(chatNodes.some(node => node.attrs.id === 'workspace'), 'Chat workspace fixture must exist');
const chatEntries = chatNodes.filter(node => node.tag === 'a' &&
  node.attrs.href?.split(/[?#]/)[0] === 'mingshen-harness.html');
assert.ok(chatEntries.length, 'Chat must link to the Harness page');
for (const node of chatEntries) {
  safeNewTab(node, 'Chat desktop entry');
  for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
    assert.notEqual(ancestor.attrs.id, 'workspace', 'Chat entry must be outside the authenticated workspace');
    assert.equal(has(ancestor, 'hidden'), false, 'Chat entry must not inherit a static hidden gate');
  }
  assert.equal(node.attrs['data-i18n-aria'], 'chat.desktopDownload');
}

function fakeClock() {
  let now = 0, sequence = 0;
  const tasks = new Map();
  return {
    setTimeout(fn, delay = 0) {
      const id = ++sequence;
      tasks.set(id, { fn, at: now + Number(delay) });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (let guard = 0; ; guard++) {
        assert.ok(guard < 100, 'unexpected repeating timer');
        const next = [...tasks].filter(([, task]) => task.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, task] = next;
        now = task.at;
        tasks.delete(id);
        task.fn();
      }
      now = end;
    },
    delays: () => [...tasks.values()].map(task => task.at - now).sort((a, b) => a - b)
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = payload => ({ ok: true, status: 200, json: async () => payload });

function harness({ i18n = 'ready', lang = 'zh' } = {}) {
  const clock = fakeClock(), requests = [], automatic = [], listeners = new Map();
  let resolveFetch, rejectFetch, aborts = 0;
  const pending = new Promise((resolve, reject) => { resolveFetch = resolve; rejectFetch = reject; });
  const anchor = attrs => {
    const node = {
      ...attrs,
      click() { automatic.push('anchor.click'); },
      dispatchEvent(event) { if (event.type === 'click') automatic.push('anchor.dispatchEvent(click)'); },
      setAttribute(name, value) { this[name] = String(value); },
      getAttribute(name) { return this[name] ?? null; },
      hasAttribute(name) { return Object.hasOwn(this, name); }
    };
    return node;
  };
  const links = downloads.map(node => anchor(node.attrs));
  const status = { dataset: { i18n: statuses[0].attrs['data-i18n'] }, textContent: statuses[0].text.trim() };
  const location = {
    assign() { automatic.push('location.assign'); },
    replace() { automatic.push('location.replace'); },
    get href() { return 'https://club.example/public/mingshen-harness.html'; },
    set href(value) { automatic.push(['location.href', value]); }
  };
  const document = {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-harness-download]', 'unexpected DOM selector');
      return links;
    },
    querySelector(selector) {
      assert.equal(selector, '[data-download-status]', 'unexpected DOM selector');
      return status;
    },
    createElement(tag) { automatic.push(['createElement', tag]); return anchor({}); },
    get location() { return location; },
    set location(value) { automatic.push(['document.location', value]); }
  };
  const sandbox = {
    document, URL, AbortController, console,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    open(...args) { automatic.push(['window.open', ...args]); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
    },
    fetch(url, options) {
      requests.push({ url, options });
      assert.ok(options.signal instanceof AbortSignal, 'fetch must receive a real AbortSignal');
      options.signal.addEventListener('abort', () => {
        aborts++;
        rejectFetch(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
      return pending;
    },
    get location() { return location; },
    set location(value) { automatic.push(['window.location', value]); }
  };
  // Browser scripts see window/globalThis as the same global object.
  sandbox.window = sandbox;
  function setI18n(mode, nextLang = lang) {
    lang = nextLang;
    if (mode === 'missing') delete sandbox.ClubI18n;
    else sandbox.ClubI18n = { t: key => mode === 'key' ? key : lookup(lang, key) ?? key };
  }
  setI18n(i18n);
  vm.runInNewContext(source, sandbox, { filename: 'mingshen-harness.js', timeout: 1000 });
  return {
    clock, links, status, requests, automatic, sandbox, setI18n,
    respond: resolveFetch, reject: rejectFetch, abortCount: () => aborts,
    language(next) { setI18n('ready', next); sandbox.dispatchEvent({ type: 'club:langchange' }); }
  };
}

function assertLinks(ui, url, label) {
  for (const link of ui.links) {
    assert.equal(link.href, url, label + ': every download href');
    safeNewTab({ tag: 'a', attrs: link }, label);
    assert.equal(link.hasAttribute('download'), false, label + ': no forced download attribute');
  }
}
function assertStatus(ui, key, lang, label) {
  assert.equal(ui.status.dataset.i18n, key, label + ': status stores its key');
  assert.equal(ui.status.textContent, lookup(lang, key), label + ': translated status');
}
function assertQuiet(ui, label) {
  assert.deepEqual(ui.automatic, [], label + ': must not open/click/navigate/download automatically');
  assert.equal(ui.requests.length, 1, label + ': only fetch configuration, never fetch the installer');
}
function assertFinished(ui, label) {
  ui.clock.advance(0);
  assert.deepEqual(ui.clock.delays(), [], label + ': clear timeout after completion');
  ui.clock.advance(8000);
  assert.equal(ui.abortCount(), 0, label + ': completed request must not abort later');
  assertQuiet(ui, label);
}

// Start-up keeps working fallback anchors and sends only a public settings read.
{
  const ui = harness();
  assertLinks(ui, repository, 'initial');
  assertStatus(ui, fallbackKey, 'zh', 'initial');
  assert.deepEqual(ui.clock.delays(), [0, 8000], 'deferred i18n refresh and eight-second timeout');
  const { url, options } = ui.requests[0];
  assert.equal(new URL(url).protocol, 'https:');
  assert.equal(new URL(url).pathname, '/functions/v1/club-drive');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { action: 'mingshen_harness_download_get' });
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.ok(options.headers.apikey, 'public endpoint key required');
  assert.equal(options.credentials, 'omit', 'public page must not send session cookies');
  assert.equal(options.cache, 'no-store', 'read latest configured download');
  assert.equal(options.signal.aborted, false);
  ui.respond(response({ downloadUrl: '' }));
  await settle();
  assertFinished(ui, 'initial');
}

// Preserve the exact signed URL, including escaping, plus signs, duplicate query
// keys and fragment. Parsing must not reserialize or strip a signature query.
const signedUrl = 'https://downloads.example/releases/Harness%20Setup.exe?X-Amz-Signature=a%2Fb%2Bc%3D&token=a+b&part=1&part=2#install';
const validUrls = [signedUrl, 'HTTPS://Downloads.Example:443/Setup.exe?sig=%2f+%2F', '  ' + signedUrl + '  '];
for (const value of validUrls) {
  const ui = harness();
  ui.respond(response({ downloadUrl: value }));
  await settle();
  assertLinks(ui, value.trim(), 'valid signed URL');
  assertStatus(ui, readyKey, 'zh', 'valid signed URL');
  ui.language('en');
  assertStatus(ui, readyKey, 'en', 'ready language change');
  assertLinks(ui, value.trim(), 'language change preserves signature');
  assertFinished(ui, 'valid signed URL');
}

const invalidUrls = [
  ['empty', ''], ['whitespace only', '   '], ['missing', undefined], ['null', null],
  ['number', 42], ['object', { href: signedUrl }], ['array', [signedUrl]],
  ['HTTP', 'http://downloads.example/Setup.exe'], ['javascript', 'javascript:alert(1)'],
  ['data', 'data:application/octet-stream;base64,AA=='], ['file', 'file:///C:/Setup.exe'],
  ['blob', 'blob:https://downloads.example/id'], ['protocol relative', '//downloads.example/Setup.exe'],
  ['relative', '/Setup.exe'],
  ['missing slash', 'https:/downloads.example/Setup.exe'], ['invalid host', 'https://[invalid/Setup.exe'],
  ['no host', 'https://'], ['username', 'https://user@downloads.example/Setup.exe'],
  ['password', 'https://user:secret@downloads.example/Setup.exe'],
  ['empty userinfo', 'https://@downloads.example/Setup.exe'],
  ['escaped userinfo', 'https://user%40name@downloads.example/Setup.exe'],
  ['backslash', 'https://downloads.example\\Setup.exe'],
  ['embedded space', 'https://downloads.example/Setup file.exe'],
  ['embedded tab', 'https://downloads.example/Set\tup.exe'],
  ['embedded newline', 'https://downloads.example/Set\nup.exe'],
  ['leading control', '\u0000' + signedUrl], ['trailing control', signedUrl + '\u001f'],
  ['DEL', 'https://downloads.example/Set\u007fup.exe'],
  ['C1 control', 'https://downloads.example/Set\u0085up.exe'],
  ['non-ASCII whitespace', 'https://downloads.example/Set\u00a0up.exe'],
  ['over 2048 characters', 'https://downloads.example/' + 'x'.repeat(2048)]
];
const failures = [
  ...invalidUrls.map(([label, value]) => [label, ui => ui.respond(response({ downloadUrl: value }))]),
  ['network rejection', ui => ui.reject(new TypeError('Failed to fetch'))],
  ['HTTP failure', ui => ui.respond({ ok: false, status: 503,
    json() { assert.fail('HTTP errors must not be treated as successful settings'); } })],
  ['invalid JSON', ui => ui.respond({ ok: true, status: 200, json: async () => JSON.parse('{invalid') })],
  ['old backend rejects action', ui => ui.respond({ ok: false, status: 400,
    json: async () => ({ error: 'Unknown action' }) })],
  ['old backend lacks downloadUrl', ui => ui.respond(response({ error: 'Unknown action' }))],
  ['null JSON', ui => ui.respond(response(null))],
  ['array JSON', ui => ui.respond(response([]))]
];
for (const [label, finish] of failures) {
  const ui = harness();
  finish(ui);
  await settle();
  assertLinks(ui, repository, label);
  assertStatus(ui, fallbackKey, 'zh', label);
  ui.language('en');
  assertStatus(ui, fallbackKey, 'en', label + ' language change');
  assertFinished(ui, label);
}

// No real timers: keep a fetch pending, cross the exact abort boundary, then
// check that its rejection is handled and repository links remain usable.
{
  const ui = harness();
  ui.clock.advance(7999);
  await settle();
  assert.equal(ui.requests[0].options.signal.aborted, false, 'do not abort before 8000ms');
  assertLinks(ui, repository, 'pending request');
  ui.clock.advance(1);
  await settle();
  assert.equal(ui.requests[0].options.signal.aborted, true, 'abort at exactly 8000ms');
  assert.equal(ui.abortCount(), 1, 'abort exactly once');
  assert.deepEqual(ui.clock.delays(), [], 'timeout leaves no timer behind');
  assertLinks(ui, repository, 'aborted request');
  assertStatus(ui, fallbackKey, 'zh', 'aborted request');
  ui.language('en');
  assertStatus(ui, fallbackKey, 'en', 'aborted request language change');
  assertQuiet(ui, 'aborted request');
}

// Delayed i18n can be absent or return a truthy key before dictionary merge.
// Test both download states, zero-delay repair, and subsequent EN -> ZH -> EN
// events; neither a translated string nor an untranslated key may be frozen.
for (const mode of ['missing', 'key']) {
  for (const ready of [false, true]) {
    const ui = harness({ i18n: mode });
    assert.equal(ui.status.textContent, statuses[0].text.trim(), mode + ': retain static fallback text');
    ui.respond(response({ downloadUrl: ready ? signedUrl : '' }));
    await settle();
    const key = ready ? readyKey : fallbackKey;
    assert.equal(ui.status.dataset.i18n, key, mode + ': retain current state key before i18n boot');
    assert.equal(ui.status.textContent, statuses[0].text.trim(), mode + ': never show a raw key');
    ui.setI18n('ready', 'en');
    ui.clock.advance(0);
    assertStatus(ui, key, 'en', mode + ': deferred refresh after dictionary merge');
    for (const lang of ['zh', 'en']) {
      ui.language(lang);
      assertStatus(ui, key, lang, mode + ': langchange redraw');
    }
    assertLinks(ui, ready ? signedUrl : repository, mode + ': language switches preserve links');
    assertFinished(ui, mode + ': delayed i18n');
  }
}

// WHATWG URL repairs extra slashes into a host, but these inputs have an empty
// raw authority and must be rejected just like the backend. Run every case even
// when one fails so a security regression does not hide the remaining results.
const malformedAuthorities = [
  'https:///host', 'https:////host',
  'https:///downloads.example/Setup.exe',
  'https:////downloads.example/Setup.exe'
];
const authorityFailures = [];
for (const value of malformedAuthorities) {
  const ui = harness();
  ui.respond(response({ downloadUrl: value }));
  await settle();
  try {
    assertLinks(ui, repository, value);
    assertStatus(ui, fallbackKey, 'zh', value);
  } catch (error) {
    authorityFailures.push(value);
    console.error('FAIL malformed authority: ' + value + '\n' + error.message);
  }
  assertFinished(ui, value);
}

console.log('Mingshen Harness page: ' + usedKeys.size + ' bilingual keys, static links and Chat placement passed.');
console.log('Real-JS VM: ' + validUrls.length + ' valid URLs, ' + failures.length +
  ' fallback cases, exact 8s abort, delayed i18n/langchange and no automatic downloads passed.');
assert.equal(authorityFailures.length, 0,
  'Malformed HTTPS authorities must fall back to the repository: ' + authorityFailures.join(', '));
console.log('Malformed HTTPS authorities: all ' + malformedAuthorities.length + ' rejected (backend-compatible).');
