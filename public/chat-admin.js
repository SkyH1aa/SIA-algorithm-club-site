import {readResponses} from './chat-core.js';

const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const t = (key, vars) => window.ClubI18n?.t(`chatAdmin.${key}`, vars) ?? key;
let session = null, epoch = 0, authorized = false, active = null;
let providers = [], models = [];
let usage = emptyUsage();
let testOutput = {visible: false, text: ''};
const messages = new Map();

function emptyUsage() { return {rows: [], page: 1, pageSize: 20, total: 0, loaded: false}; }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}
function asArray(value) { return Array.isArray(value) ? value : []; }
function first(...values) { return values.find(value => value != null && value !== '') ?? ''; }
function modelKey(item) { return first(item?.model_key, item?.model_id, '-'); }
function providerLabel(id) {
  const item = providers.find(row => row.id === id);
  return first(item?.label, item?.name, '-');
}
function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  const locale = window.ClubI18n?.getLang() === 'en' ? 'en-US' : 'zh-CN';
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString(locale, {dateStyle: 'medium', timeStyle: 'short'});
}
function setMessage(id, key = '', type = '', vars = {}) {
  messages.set(id, {key, type, vars});
  renderMessage(id);
}
function renderMessage(id) {
  const message = messages.get(id);
  $(id).textContent = message?.key ? t(message.key, message.vars) : '';
  $(id).classList.toggle('error', message?.type === 'error');
  $(id).classList.toggle('success', message?.type === 'success');
  $(id).classList.toggle('warning', message?.type === 'warning');
}
function renderTestOutput() {
  $('testResult').hidden = !testOutput.visible;
  $('testResult').textContent = testOutput.visible ? testOutput.text || t('testEmpty') : '';
}
function setGate() {
  const logged = Boolean(session?.user?.id);
  $('loginGate').hidden = logged;
  $('deniedGate').hidden = !logged || authorized;
  $('adminContent').hidden = !logged || !authorized;
}
function pages() { return Math.max(1, Math.ceil((usage.total ?? 0) / usage.pageSize)); }
function hasNextPage() { return usage.loaded && (usage.total == null ? usage.rows.length === usage.pageSize : usage.page < pages()); }
function controls() {
  const disabled = Boolean(active) || !authorized;
  for (const id of ['providerForm', 'modelForm', 'testForm', 'usageFilter']) {
    for (const node of $(id).elements) node.disabled = disabled;
    $(id).setAttribute('aria-busy', String(Boolean(active)));
  }
  for (const id of ['refreshButton', 'refreshUsageButton']) $(id).disabled = disabled;
  $('retryButton').disabled = Boolean(active) || !session;
  document.querySelectorAll('[data-edit-provider], [data-edit-model]').forEach(node => { node.disabled = disabled; });
  $('usagePrev').disabled = disabled || usage.page <= 1;
  $('usageNext').disabled = disabled || !hasNextPage();
  $('testForm').querySelector('button[type="submit"]').disabled = disabled || !$('testModel').value;
}
function current(run) { return active === run && run.epoch === epoch && !run.controller.signal.aborted; }
function assertCurrent(run) { if (!current(run)) throw new DOMException('Stale account request', 'AbortError'); }
async function request(run, action, body = {}, stream = false) {
  assertCurrent(run);
  if (!session?.access_token) throw new Error('login');
  const response = await fetch(CHAT_URL, {
    method: 'POST', signal: run.controller.signal,
    headers: {'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: `Bearer ${session.access_token}`},
    body: JSON.stringify({action, ...body})
  });
  assertCurrent(run);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    assertCurrent(run);
    const error = new Error(payload?.error || 'request');
    error.status = response.status;
    throw error;
  }
  if (stream) {
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('request');
    return response;
  }
  const payload = await response.json();
  assertCurrent(run);
  return payload;
}
function errorKey(error) {
  if (error.status === 403 || error.message === 'admin') return 'unauthorized';
  if (error.status === 401 || error.message === 'login') return 'loginExpired';
  return ({busy: 'busy', input: 'invalidInput', model: 'invalidModel', provider_url: 'invalidUrl', secret_name: 'invalidSecret', secret_missing: 'secretMissing', upstream: 'upstreamFailed', context: 'invalidOutput', database: 'databaseFailed'})[error.message] || 'requestFailed';
}
async function operation(messageId, work, {verify = false} = {}) {
  if (active || !session?.user?.id || (!authorized && !verify)) return;
  const run = {epoch, controller: new AbortController()};
  active = run;
  controls();
  try { await work(run); }
  catch (error) {
    if (!current(run) || error.name === 'AbortError') return;
    if (error.status === 401 || error.status === 403) {
      authorized = false;
      clearSensitive();
      setGate();
      setMessage('gateMessage', errorKey(error), 'error');
    } else setMessage(messageId, errorKey(error), 'error');
  } finally {
    if (active === run && run.epoch === epoch) { active = null; controls(); }
  }
}
function renderProviderOptions() {
  const previous = $('modelProvider').value;
  $('modelProvider').replaceChildren();
  for (const item of providers) $('modelProvider').add(new Option(`${first(item.label, item.name)}${item.enabled === false ? ` · ${t('disabledBadge')}` : ''}`, item.id));
  if (!providers.length) $('modelProvider').add(new Option(t('noProvider'), ''));
  if (providers.some(item => item.id === previous)) $('modelProvider').value = previous;
}
function availableModels() { return models.filter(item => item.enabled !== false && providers.some(row => row.id === item.provider_id && row.enabled !== false)); }
function configureTestBudget(reset = false) {
  const item = models.find(row => row.id === $('testModel').value);
  const max = item?.max_output_tokens || 131072;
  $('testOutput').max = String(max);
  if (reset || Number($('testOutput').value) > max) $('testOutput').value = String(Math.min(256, max));
}
function renderModelOptions() {
  const previous = $('testModel').value, enabled = availableModels();
  $('testModel').replaceChildren();
  for (const item of enabled) $('testModel').add(new Option(`${first(item.display_name, modelKey(item))} · ${modelKey(item)} · ${providerLabel(item.provider_id)}`, item.id));
  if (!enabled.length) $('testModel').add(new Option(t('noModel'), ''));
  if (enabled.some(item => item.id === previous)) $('testModel').value = previous;
  configureTestBudget();
}
function badge(enabled) { return `<span class="chat-admin-badge ${enabled ? 'on' : 'off'}">${escapeHtml(t(enabled ? 'enabledBadge' : 'disabledBadge'))}</span>`; }
function table(headers, rows) {
  return `<table class="chat-admin-table"><thead><tr>${headers.map(key => `<th scope="col">${escapeHtml(t(key))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}
function editButton(kind, id) { return `<button class="chat-admin-button chat-admin-secondary" type="button" data-edit-${kind}="${escapeHtml(id)}">${escapeHtml(t('edit'))}</button>`; }
function cells(values) { return values.map(value => `<td>${escapeHtml(value)}</td>`).join(''); }
function renderProviders() {
  $('providersList').innerHTML = providers.length ? table(['providerId', 'providerLabel', 'baseUrl', 'secretName', 'authHeader', 'enabled', 'edit'], providers.map(item => `<tr>${cells([item.name, first(item.label, '-'), item.base_url, item.secret_name, item.auth_header || 'authorization'])}<td>${badge(item.enabled !== false)}</td><td>${editButton('provider', item.id)}</td></tr>`).join('')) : `<div class="chat-admin-empty">${escapeHtml(t('noProvider'))}</div>`;
}
function renderModels() {
  $('modelsList').innerHTML = models.length ? table(['modelId', 'modelLabel', 'modelProvider', 'contextWindow', 'maxOutput', 'enabled', 'edit'], models.map(item => `<tr>${cells([modelKey(item), first(item.display_name, '-'), providerLabel(item.provider_id), item.context_window, item.max_output_tokens])}<td>${badge(item.enabled !== false)}</td><td>${editButton('model', item.id)}</td></tr>`).join('')) : `<div class="chat-admin-empty">${escapeHtml(t('noModel'))}</div>`;
}
function usageStatus(value) {
  const key = ({completed: 'success', success: 'success', incomplete: 'incomplete', interrupted: 'interrupted', cancelled: 'cancelled', failed: 'failure', failure: 'failure', audited: 'audited', upstream_started: 'running'})[value];
  return key ? t(`usageStatus.${key}`) : first(value, '-');
}
function renderUsage() {
  $('usageList').innerHTML = usage.rows.length ? table(['identity', 'account', 'model', 'provider', 'startedAt', 'finishedAt', 'status', 'inputTokens', 'outputTokens', 'total', 'requestId'], usage.rows.map(item => {
    const model = models.find(row => row.id === item.model_id);
    return `<tr>${cells([first(item.member_name, item.name, '-'), first(item.username, item.account, item.email, item.user_id, '-'), first(item.model_key, model && modelKey(model), '-'), first(item.provider_name, item.provider_label, item.provider?.name, providerLabel(first(item.provider_id, model?.provider_id))), formatTime(first(item.started_at, item.created_at)), formatTime(item.finished_at), usageStatus(item.status), first(item.input_tokens, 0), first(item.output_tokens, 0), first(item.total_tokens, 0), first(item.request_id, item.id, '-')])}</tr>`;
  }).join('')) : `<div class="chat-admin-empty">${escapeHtml(t('noRows'))}</div>`;
  $('usagePageLabel').textContent = t(usage.total == null ? 'pageUnknown' : 'page', {page: usage.page, pages: pages()});
  $('usageCount').textContent = usage.loaded ? String(usage.rows.length) : '--';
  $('totalTokens').textContent = usage.loaded ? String(usage.rows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0)) : '--';
}
function refreshLocalizedUi() {
  window.ClubI18n?.apply(document);
  renderProviderOptions(); renderModelOptions(); renderProviders(); renderModels(); renderUsage();
  for (const id of messages.keys()) renderMessage(id);
  renderTestOutput(); controls();
}
function usageQuery(page = usage.page) {
  const from = $('usageFrom').value ? new Date($('usageFrom').value) : null;
  const to = $('usageTo').value ? new Date($('usageTo').value) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) throw new Error('date');
  return {page, pageSize: Number($('usagePageSize').value), from: from?.toISOString() || null, to: to?.toISOString() || null};
}
async function loadUsage(run, query = usageQuery()) {
  const payload = await request(run, 'usage', query);
  assertCurrent(run);
  const rows = asArray(payload.usage || payload.rows);
  usage = {rows, page: query.page, pageSize: query.pageSize, total: Number.isFinite(payload.total) ? payload.total : null, loaded: true};
  renderUsage();
}
async function loadAdmin(run) {
  setMessage('statusHint', 'loading');
  const payload = await request(run, 'admin_get');
  assertCurrent(run);
  if (payload.authorized === false || payload.isSuperAdmin === false) { const error = new Error('admin'); error.status = 403; throw error; }
  providers = asArray(payload.providers); models = asArray(payload.models);
  authorized = true;
  $('providerCount').textContent = String(providers.length);
  $('modelCount').textContent = String(models.filter(item => item.enabled !== false).length);
  renderProviderOptions(); renderModelOptions(); renderProviders(); renderModels(); setGate(); controls();
  setMessage('gateMessage');
  setMessage('statusHint', 'loaded', '', {providers: providers.length, models: models.length});
  try { await loadUsage(run); setMessage('usageMessage'); }
  catch (error) {
    assertCurrent(run);
    if (error.status === 401 || error.status === 403) throw error;
    setMessage('usageMessage', error.message === 'date' ? 'invalidDates' : errorKey(error), 'error');
  }
}
function clearProvider() { $('providerForm').reset(); $('providerId').value = ''; }
function syncDefaultOutputMax() { $('defaultOutputTokens').max = String(Math.min(131072, Math.max(1, Number($('maxOutputTokens').value) || 1))); }
function clearModel() { $('modelForm').reset(); $('modelConfigId').value = ''; syncDefaultOutputMax(); }
function clearSensitive() {
  providers = []; models = []; usage = emptyUsage(); testOutput = {visible: false, text: ''};
  clearProvider(); clearModel(); $('testForm').reset(); $('usageFilter').reset();
  $('modelProvider').replaceChildren(); $('testModel').replaceChildren();
  messages.clear();
  for (const id of ['statusHint', 'gateMessage', 'providerMessage', 'modelMessage', 'testMessage', 'usageMessage']) setMessage(id);
  for (const id of ['providerCount', 'modelCount', 'usageCount', 'totalTokens']) $(id).textContent = '--';
  refreshLocalizedUi();
}
function validInteger(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }

$('providersList').addEventListener('click', event => {
  if (active || !authorized) return;
  const button = event.target.closest('[data-edit-provider]');
  const item = providers.find(row => row.id === button?.dataset.editProvider);
  if (!item) return;
  $('providerId').value = item.id; $('providerName').value = item.name;
  $('providerLabel').value = item.label || ''; $('providerBaseUrl').value = item.base_url;
  $('providerSecretName').value = item.secret_name; $('providerAuthHeader').value = item.auth_header || 'authorization';
  $('providerEnabled').checked = item.enabled !== false; setMessage('providerMessage'); $('providerName').focus();
});
$('modelsList').addEventListener('click', event => {
  if (active || !authorized) return;
  const button = event.target.closest('[data-edit-model]');
  const item = models.find(row => row.id === button?.dataset.editModel);
  if (!item) return;
  $('modelConfigId').value = item.id; $('modelId').value = modelKey(item);
  $('modelLabel').value = item.display_name; $('modelProvider').value = item.provider_id;
  $('contextWindow').value = item.context_window; $('maxOutputTokens').value = item.max_output_tokens;
  $('defaultOutputTokens').value = item.default_max_output_tokens; syncDefaultOutputMax();
  $('reasoningEfforts').value = asArray(item.reasoning_efforts).join(','); $('defaultReasoning').value = item.default_reasoning_effort || '';
  $('supportsImages').checked = item.supports_images === true; $('supportsPdf').checked = item.supports_pdf === true;
  $('preserveReasoning').checked = item.preserve_reasoning === true; $('modelEnabled').checked = item.enabled !== false;
  setMessage('modelMessage'); $('modelId').focus();
});
$('providerForm').addEventListener('submit', event => {
  event.preventDefault();
  if (active || !authorized || !$('providerForm').reportValidity()) return;
  const body = {id: $('providerId').value || null, name: $('providerName').value.trim(), label: $('providerLabel').value.trim(), base_url: $('providerBaseUrl').value.trim(), secret_name: $('providerSecretName').value.trim(), auth_header: $('providerAuthHeader').value, enabled: $('providerEnabled').checked};
  if (!body.name || body.name.length > 80 || body.label.length > 120) return setMessage('providerMessage', 'providerRequired', 'error');
  if (!/^CHAT_KEY_[A-Z0-9_]{1,80}$/.test(body.secret_name)) return setMessage('providerMessage', 'invalidSecret', 'error');
  try {
    const url = new URL(body.base_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || /(^|\/)responses\/?$/i.test(url.pathname)) throw new Error();
  } catch { return setMessage('providerMessage', 'invalidUrl', 'error'); }
  void operation('providerMessage', async run => {
    setMessage('providerMessage', 'saving');
    await request(run, 'save_provider', body); assertCurrent(run);
    clearProvider(); setMessage('providerMessage', 'providerSaved', 'success');
    await loadAdmin(run);
  });
});
$('modelForm').addEventListener('submit', event => {
  event.preventDefault();
  if (active || !authorized || !$('modelForm').reportValidity()) return;
  const efforts = $('reasoningEfforts').value.split(',').map(value => value.trim()).filter(Boolean);
  const body = {id: $('modelConfigId').value || null, model_key: $('modelId').value.trim(), display_name: $('modelLabel').value.trim(), provider_id: $('modelProvider').value, context_window: Number($('contextWindow').value), max_output_tokens: Number($('maxOutputTokens').value), default_max_output_tokens: Number($('defaultOutputTokens').value), reasoning_efforts: efforts, default_reasoning_effort: $('defaultReasoning').value.trim() || null, supports_images: $('supportsImages').checked, supports_pdf: $('supportsPdf').checked, preserve_reasoning: $('preserveReasoning').checked, enabled: $('modelEnabled').checked};
  if (!body.model_key || body.model_key.length > 160 || !body.display_name || body.display_name.length > 120 || !body.provider_id) return setMessage('modelMessage', 'modelRequired', 'error');
  if (!validInteger(body.context_window, 256, 1000000) || !validInteger(body.max_output_tokens, 1, 131072) || !validInteger(body.default_max_output_tokens, 1, body.max_output_tokens)) return setMessage('modelMessage', 'invalidLimits', 'error');
  if (efforts.length > 12 || efforts.some(value => value.length > 40) || (body.default_reasoning_effort?.length || 0) > 40) return setMessage('modelMessage', 'invalidReasoning', 'error');
  void operation('modelMessage', async run => {
    setMessage('modelMessage', 'saving');
    await request(run, 'save_model', body); assertCurrent(run);
    clearModel(); setMessage('modelMessage', 'modelSaved', 'success');
    await loadAdmin(run);
  });
});
$('testForm').addEventListener('submit', event => {
  event.preventDefault();
  if (active || !authorized || !$('testForm').reportValidity()) return;
  const item = availableModels().find(row => row.id === $('testModel').value);
  if (!item) return setMessage('testMessage', 'noModel', 'error');
  const prompt = $('testPrompt').value.trim(), output = Number($('testOutput').value);
  if (!prompt || prompt.length > 12000) return setMessage('testMessage', 'invalidPrompt', 'error');
  if (!validInteger(output, 1, Math.min(131072, item.max_output_tokens))) return setMessage('testMessage', 'invalidOutput', 'error');
  if (!window.confirm(t('testConfirm'))) return;
  void operation('testMessage', async run => {
    testOutput = {visible: false, text: ''}; renderTestOutput(); setMessage('testMessage', 'testRunning');
    let streaming = false;
    try {
      const response = await request(run, 'test', {model_id: item.id, prompt, max_output_tokens: output, reasoning_effort: null}, true);
      streaming = true;
      const result = await readResponses(response.body, update => {
        if (!current(run)) return;
        testOutput = {visible: true, text: update.text}; renderTestOutput();
      });
      assertCurrent(run);
      testOutput = {visible: true, text: result.text}; renderTestOutput();
      const state = ({success: ['testComplete', 'success'], incomplete: ['testIncomplete', 'warning'], interrupted: ['testInterrupted', 'warning'], failure: ['testFailure', 'error']})[result.status] || ['testFailure', 'error'];
      setMessage('testMessage', ...state);
    } catch (error) {
      assertCurrent(run);
      if (error.status === 401 || error.status === 403) throw error;
      testOutput.visible = true; renderTestOutput();
      setMessage('testMessage', streaming ? 'testInterrupted' : errorKey(error), streaming ? 'warning' : 'error');
    }
    try { await loadUsage(run); setMessage('usageMessage'); }
    catch (error) {
      assertCurrent(run);
      if (error.status === 401 || error.status === 403) throw error;
      setMessage('usageMessage', error.message === 'date' ? 'invalidDates' : errorKey(error), 'error');
    }
  });
});
function refreshUsage(page = usage.page) {
  if (active || !authorized) return;
  let query;
  try { query = usageQuery(page); }
  catch { return setMessage('usageMessage', 'invalidDates', 'error'); }
  void operation('usageMessage', async run => { setMessage('usageMessage', 'loading'); await loadUsage(run, query); setMessage('usageMessage'); });
}
$('usageFilter').addEventListener('submit', event => { event.preventDefault(); refreshUsage(1); });
$('usagePrev').onclick = () => { if (usage.page > 1) refreshUsage(usage.page - 1); };
$('usageNext').onclick = () => { if (hasNextPage()) refreshUsage(usage.page + 1); };
$('refreshUsageButton').onclick = () => refreshUsage();
$('refreshButton').onclick = () => void operation('statusHint', loadAdmin);
$('retryButton').onclick = () => void operation('gateMessage', loadAdmin, {verify: true});
$('clearProviderButton').onclick = () => { if (!active) { clearProvider(); setMessage('providerMessage'); } };
$('clearModelButton').onclick = () => { if (!active) { clearModel(); setMessage('modelMessage'); } };
$('maxOutputTokens').addEventListener('input', syncDefaultOutputMax);
$('testModel').addEventListener('change', () => { configureTestBudget(true); controls(); });
window.ClubI18n?.mountSwitcher($('languageSwitcher'));
window.addEventListener('club:langchange', refreshLocalizedUi);
setTimeout(refreshLocalizedUi, 0);

function updateSession(next) {
  const nextId = next?.user?.id || null;
  if ((session?.user?.id || null) === nextId) { session = next; return; }
  epoch++;
  active?.controller.abort(); active = null; session = next; authorized = false;
  clearSensitive(); setGate(); controls();
  if (nextId) {
    setMessage('gateMessage', 'loading');
    void operation('gateMessage', loadAdmin, {verify: true});
  }
}
// Process account changes immediately; a delayed old callback must not restore a previous account.
let authEvent = 0;
client.auth.onAuthStateChange((_event, next) => { authEvent++; updateSession(next); });
const initialAuthEvent = authEvent;
client.auth.getSession().then(({data, error}) => {
  if (authEvent !== initialAuthEvent) return;
  if (error) { setMessage('gateMessage', 'loginExpired', 'error'); return; }
  updateSession(data.session);
}).catch(() => { if (authEvent === initialAuthEvent) setMessage('gateMessage', 'loginExpired', 'error'); });
