import {readResponses} from './chat-core.js';

const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const t = (key, vars) => window.ClubI18n?.t(`chatAdmin.${key}`, vars) ?? key;
let session = null, epoch = 0, authorized = false, active = null;
let providers = [], models = [];
let proxyRoutes = [], proxyKeys = [], proxyLoaded = false, proxyEditingVersion = 0, proxyPlaintext = '';
let usage = emptyUsage();
let directory = [], blacklist = [], directoryLoaded = false, selectedUser = '', selectionEpoch = 0;
let modelAccess = null, modelAccessDraft = null, modelAccessModelId = '', modelAccessEpoch = 0;
let globalQuota = null, userQuota = null;
let testOutput = {visible: false, text: ''};
const messages = new Map();
const API_PROTOCOLS = ['auto', 'responses', 'messages', 'chat'];
const API_PROTOCOL_LABELS = {auto: 'apiProtocolAuto', responses: 'apiProtocolResponses', messages: 'apiProtocolMessages', chat: 'apiProtocolChat'};
function providerApiProtocol(item) { return API_PROTOCOLS.includes(item?.api_protocol) ? item.api_protocol : 'auto'; }
function resolvedProviderProtocol(item) {
  const protocol = providerApiProtocol(item);
  if (protocol !== 'auto') return protocol;
  try {
    const path = new URL(item?.base_url).pathname.replace(/\/+$/, '');
    return /\/messages?$/i.test(path) ? 'messages' : /\/chat\/completions$/i.test(path) ? 'chat' : 'responses';
  } catch { return 'responses'; }
}
function modelUsesMessages(item) { return resolvedProviderProtocol(providers.find(row => row.id === item?.provider_id)) === 'messages'; }
function refreshThinkingControls() {
  const messages = modelUsesMessages({provider_id: $('modelProvider').value});
  const mode = $('modelClaudeThinkingMode').value;
  const busy = Boolean(active) || !authorized;
  for (const id of ['reasoningEfforts', 'defaultReasoning']) {
    $(`${id}Field`).hidden = messages;
    $(id).disabled = busy || messages;
  }
  for (const [id, visible] of [['modelClaudeThinkingMode', messages], ['modelClaudeThinkingBudget', messages && mode === 'enabled'], ['modelClaudeThinkingEfforts', messages && mode === 'adaptive'], ['modelClaudeDefaultEffort', messages && mode === 'adaptive']]) {
    $(`${id}Field`).hidden = !visible;
    $(id).disabled = busy || !visible;
  }
  $('modelClaudeThinkingBudget').required = messages && mode === 'enabled';
  $('modelClaudeThinkingHelp').hidden = !messages;
}
function fillClaudeThinking(item) {
  const config = item?.claude_thinking;
  $('modelClaudeThinkingMode').value = config?.mode || 'omit';
  $('modelClaudeThinkingBudget').value = config?.budget_tokens ?? 1024;
  $('modelClaudeThinkingEfforts').value = asArray(config?.efforts).join(',');
  $('modelClaudeDefaultEffort').value = config?.default_effort || '';
  refreshThinkingControls();
}
function claudeThinkingInput(defaultOutput) {
  if (!modelUsesMessages({provider_id: $('modelProvider').value})) return {mode: 'omit'};
  const mode = $('modelClaudeThinkingMode').value;
  if (mode === 'omit' || mode === 'disabled') return {mode};
  if (mode === 'enabled') {
    const budget_tokens = Number($('modelClaudeThinkingBudget').value);
    if (!validInteger(budget_tokens, 1024, defaultOutput - 1)) throw new Error('claude_thinking_budget');
    return {mode, budget_tokens};
  }
  if (mode === 'adaptive') {
    const efforts = $('modelClaudeThinkingEfforts').value.split(',').map(value => value.trim()).filter(Boolean);
    const default_effort = $('modelClaudeDefaultEffort').value.trim() || null;
    if (efforts.some(value => !['low', 'medium', 'high', 'xhigh', 'max'].includes(value)) || new Set(efforts).size !== efforts.length || (default_effort && !efforts.includes(default_effort))) throw new Error('claude_effort');
    return {mode, efforts, default_effort};
  }
  throw new Error('claude_thinking');
}

function emptyUsage() { return {rows: [], page: 1, pageSize: 20, total: 0, summary: null, loaded: false}; }
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
  applyAdminTab();
}
// 各分区由标签页托管：每次进入控制台都重新应用当前分区，
// 避免重新认证或刷新数据后把多个分区同时展开。
function applyAdminTab() {
  // 部分测试桩只实现了 getElementById；缺少 querySelector 时跳过即可。
  if (typeof document.querySelector !== 'function') return;
  const nav = document.querySelector('.chat-admin-tabs');
  if (!nav || $('adminContent').hidden) return;
  const active = nav.querySelector('[role="tab"][aria-selected="true"]') || nav.querySelector('[role="tab"]');
  if (active) { nav.dataset.activeTab = ''; active.click(); }
}
function pages() { return Math.max(1, Math.ceil((usage.total ?? 0) / usage.pageSize)); }
function hasNextPage() { return usage.loaded && (usage.total == null ? usage.rows.length === usage.pageSize : usage.page < pages()); }
function controls() {
  const disabled = Boolean(active) || !authorized;
  for (const id of ['providerForm', 'modelForm', 'modelAccessForm', 'testForm', 'usageFilter', 'globalQuotaForm', 'quotaUserForm', 'userQuotaForm', 'blacklistForm', 'proxyRouteForm', 'proxyKeyForm']) {
    for (const node of $(id).elements) node.disabled = disabled;
    $(id).setAttribute('aria-busy', String(Boolean(active)));
  }
  for (const id of ['refreshButton', 'refreshUsageButton', 'refreshQuotaButton']) $(id).disabled = disabled;
  for (const node of $('globalQuotaForm').elements) node.disabled = disabled || !globalQuota;
  $('quotaUser').disabled = disabled || !directoryLoaded;
  for (const id of ['userQuotaForm', 'blacklistForm']) {
    for (const node of $(id).elements) node.disabled = disabled || !selectedUser || !userQuota;
  }
  $('retryButton').disabled = Boolean(active) || !session;
  document.querySelectorAll('[data-edit-provider], [data-edit-model], [data-delete-provider], [data-delete-model]').forEach(node => { node.disabled = disabled; });
  $('refreshProxyButton').disabled = disabled;
  $('proxyKeyRoute').disabled = disabled || !proxyLoaded || !proxyRoutes.length;
  $('createProxyKeyButton').disabled = disabled || !$('proxyKeyRoute').value;
  $('copyProxyKeyButton').disabled = !authorized || !proxyPlaintext;
  document.querySelectorAll('[data-proxy-edit], [data-proxy-route-state], [data-proxy-route-delete], [data-proxy-route-hard-delete], [data-proxy-key-state], [data-proxy-key-revoke], [data-proxy-key-hard-delete]').forEach(node => { node.disabled = disabled; });
  $('usagePrev').disabled = disabled || usage.page <= 1;
  $('usageNext').disabled = disabled || !hasNextPage();
  $('testForm').querySelector('button[type="submit"]').disabled = disabled || !$('testModel').value;
  $('accessModel').disabled = disabled || !models.length;
  $('accessVisibility').disabled = disabled || !modelAccess;
  $('accessSelectAll').disabled = disabled || !directoryLoaded || !modelAccess;
  document.querySelectorAll('[data-access-user]').forEach(node => { node.disabled = disabled || !modelAccess; });
  refreshThinkingControls();
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
    error.action = action;
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
function blockedTest(error) { return error.status === 403 && error.message === 'blacklisted' && ['test', 'admin_test'].includes(error.action); }
function errorKey(error) {
  if (error.message === 'proxy_url') return 'proxyInvalidUrl';
  if (error.message === 'busy') return 'busy';
  if (error.status === 409 && error.message === 'conflict') return 'quotaConflict';
  if (error.status === 409 && error.message === 'deleted') return 'alreadyDeleted';
  if (error.status === 404 && error.message === 'not_found') return 'alreadyDeleted';
  if (error.status === 429 && error.message === 'quota') return 'testQuota';
  if (blockedTest(error)) return 'testBlacklisted';
  if (error.status === 403 || error.message === 'admin') return 'unauthorized';
  if (error.status === 401 || error.message === 'login') return 'loginExpired';
  return ({quota_input: 'invalidQuota', busy: 'busy', input: 'invalidInput', model: 'invalidModel', provider_url: 'invalidUrl', api_protocol: 'invalidApiProtocol', claude_thinking: 'claudeThinkingInvalid', claude_thinking_budget: 'claudeThinkingBudgetInvalid', claude_effort: 'claudeEffortInvalid', reasoning_history_unsupported: 'reasoningHistoryUnsupported', reasoning_effort_unsupported: 'reasoningEffortUnsupported', reasoning_budget: 'reasoningBudget', effort: 'reasoningEffortInvalid', secret_name: 'invalidSecret', secret_missing: 'secretMissing', upstream: 'upstreamFailed', context: 'invalidOutput', database: 'databaseFailed'})[error.message] || 'requestFailed';
}
async function operation(messageId, work, {verify = false} = {}) {
  if (active || !session?.user?.id || (!authorized && !verify)) return;
  const run = {epoch, controller: new AbortController()};
  active = run;
  controls();
  try { await work(run); }
  catch (error) {
    if (!current(run) || error.name === 'AbortError') return;
    if (error.status === 401 || (error.status === 403 && !blockedTest(error))) {
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
let testBudgetModelId = '';
function configureTestBudget(reset = false) {
  const item = models.find(row => row.id === $('testModel').value);
  const max = item?.max_output_tokens || 131072;
  const budget = modelUsesMessages(item) && item?.claude_thinking?.mode === 'enabled' ? item.claude_thinking.budget_tokens : 0;
  $('testOutput').max = String(max);
  // Re-rendering translations must never overwrite an administrator's draft.
  if (reset || testBudgetModelId !== (item?.id || '')) $('testOutput').value = String(Math.min(budget ? budget + Math.max(256, Math.ceil(budget / 4)) : 256, max));
  testBudgetModelId = item?.id || '';
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
// 删除与编辑同处一个操作单元格；危险操作单独用 danger 样式区分。
function deleteButton(kind, id, labelKey) {
  return `<button class="chat-admin-button chat-admin-danger" type="button" data-delete-${kind}="${escapeHtml(id)}">${escapeHtml(t(labelKey))}</button>`;
}
function rowActions(kind, id, labelKey) {
  return `<div class="chat-admin-actions">${editButton(kind, id)}${deleteButton(kind, id, labelKey)}</div>`;
}
function cells(values) { return values.map(value => `<td>${escapeHtml(value)}</td>`).join(''); }
function renderProviders() {
  $('providersList').innerHTML = providers.length ? table(['providerId', 'providerLabel', 'baseUrl', 'apiProtocol', 'secretName', 'authHeader', 'enabled', 'actions'], providers.map(item => `<tr>${cells([item.name, first(item.label, '-'), item.base_url, t(API_PROTOCOL_LABELS[providerApiProtocol(item)]), item.secret_name, item.auth_header || 'authorization'])}<td>${badge(item.enabled !== false)}</td><td>${rowActions('provider', item.id, 'deleteProvider')}</td></tr>`).join('')) : `<div class="chat-admin-empty">${escapeHtml(t('noProvider'))}</div>`;
}
function renderModels() {
  $('modelsList').innerHTML = models.length ? table(['modelId', 'modelLabel', 'modelIntroduction', 'modelProvider', 'contextWindow', 'maxOutput', 'enabled', 'actions'], models.map(item => `<tr>${cells([modelKey(item), first(item.display_name, '-'), first(item.introduction, '-'), providerLabel(item.provider_id), item.context_window, item.max_output_tokens])}<td>${badge(item.enabled !== false)}</td><td>${rowActions('model', item.id, 'deleteModel')}</td></tr>`).join('')) : `<div class="chat-admin-empty">${escapeHtml(t('noModel'))}</div>`;
  renderAccessModels();
}
function renderAccessModels() {
  const previous = $('accessModel').value;
  $('accessModel').replaceChildren(new Option(t('selectModel'), ''));
  for (const item of models) $('accessModel').add(new Option(`${first(item.display_name, modelKey(item))} · ${modelKey(item)}`, item.id));
  if (models.some(item => item.id === previous)) $('accessModel').value = previous;
  renderAccessUsers();
}
function renderAccessUsers() {
  const selectedIds = modelAccessDraft?.user_ids || [];
  $('accessUsers').innerHTML = directoryLoaded && directory.length ? directory.map(item => `<label class="chat-admin-access-user"><input type="checkbox" data-access-user="${escapeHtml(item.user_id)}" ${selectedIds.includes(item.user_id) ? 'checked' : ''}><span>${escapeHtml(userLabel(item))}</span></label>`).join('') : `<div class="chat-admin-empty">${escapeHtml(t(directoryLoaded ? 'noUsers' : 'accessUsersNotLoaded'))}</div>`;
  $('accessVisibility').value = modelAccessDraft?.visibility || modelAccess?.visibility || 'all';
  controls();
}
async function loadModelAccess(run, modelId = $('accessModel').value, revision = modelAccessEpoch) {
  if (!modelId) { modelAccess = null; modelAccessDraft = null; modelAccessModelId = ''; renderAccessUsers(); return; }
  const payload = await request(run, 'admin_model_access_get', {model_id: modelId});
  assertCurrent(run);
  if (modelAccessModelId !== modelId || modelAccessEpoch !== revision) throw new DOMException('Stale model access selection', 'AbortError');
  modelAccess = {model_id: payload.model_id, visibility: payload.visibility, version: payload.version, user_ids: asArray(payload.user_ids)};
  modelAccessDraft = {visibility: modelAccess.visibility, user_ids: [...modelAccess.user_ids]};
  renderAccessUsers();
}
async function saveModelAccess(run, modelId, revision, body) {
  setMessage('modelAccessMessage', 'saving');
  try {
    const payload = await request(run, 'admin_model_access_save', body);
    assertCurrent(run);
    if (modelAccessModelId !== modelId || modelAccessEpoch !== revision) throw new DOMException('Stale model access selection', 'AbortError');
    modelAccess = {model_id: payload.model_id, visibility: payload.visibility, version: payload.version, user_ids: asArray(payload.user_ids)};
    modelAccessDraft = {visibility: modelAccess.visibility, user_ids: [...modelAccess.user_ids]};
    renderAccessUsers(); setMessage('modelAccessMessage', 'accessSaved', 'success');
  } catch (error) {
    assertCurrent(run);
    if (error.status !== 409 || error.message !== 'conflict') throw error;
    await loadModelAccess(run, modelId, revision);
    setMessage('modelAccessMessage', 'accessConflict', 'warning');
  }
}
function usageStatus(value) {
  const key = ({completed: 'success', success: 'success', incomplete: 'incomplete', interrupted: 'interrupted', cancelled: 'cancelled', failed: 'failure', failure: 'failure', audited: 'audited', upstream_started: 'running'})[value];
  return key ? t(`usageStatus.${key}`) : first(value, '-');
}
function formatUsageTokens(value) {
  const locale = window.ClubI18n?.getLang() === 'en' ? 'en-US' : 'zh-CN';
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value).toLocaleString(locale);
  return Number.isInteger(value) && value >= 0 ? value.toLocaleString(locale) : '--';
}
function renderUsage() {
  $('usageList').innerHTML = usage.rows.length ? table(['identity', 'account', 'model', 'provider', 'startedAt', 'finishedAt', 'status', 'inputTokens', 'outputTokens', 'total', 'requestId'], usage.rows.map(item => {
    const model = models.find(row => row.id === item.model_id);
    return `<tr>${cells([first(item.member_name, item.name, '-'), first(item.username, item.account, item.email, item.user_id, '-'), first(item.model_key, model && modelKey(model), '-'), first(item.provider_name, item.provider_label, item.provider?.name, providerLabel(first(item.provider_id, model?.provider_id))), formatTime(first(item.started_at, item.created_at)), formatTime(item.finished_at), usageStatus(item.status), first(item.input_tokens, 0), first(item.output_tokens, 0), first(item.total_tokens, 0), first(item.request_id, item.id, '-')])}</tr>`;
  }).join('')) : `<div class="chat-admin-empty">${escapeHtml(t('noRows'))}</div>`;
  $('usagePageLabel').textContent = t(usage.total == null ? 'pageUnknown' : 'page', {page: usage.page, pages: pages()});
  // Only the server summary covers the rolling 90-day window, independent of filters and pages.
  $('usageCount').textContent = Number.isFinite(usage.summary?.total_records) ? String(usage.summary.total_records) : '--';
  $('totalTokens').textContent = formatUsageTokens(usage.summary?.total_tokens);
}
function quotaValue(value) { return value == null ? t('unlimited') : String(value); }
function userLabel(item) { return `${first(item.username, item.user_id)} · ${first(item.member_name, t('noMemberName'))}`; }
function renderQuotaDirectory() {
  $('quotaUser').replaceChildren(new Option(t(directoryLoaded && !directory.length ? 'noUsers' : 'selectUser'), ''));
  for (const item of directory) $('quotaUser').add(new Option(userLabel(item), item.user_id));
  $('quotaUser').value = selectedUser;
  $('blacklistList').innerHTML = blacklist.length ? table(['quotaUser', 'blacklistReason'], blacklist.map(item => {
    const user = directory.find(row => row.user_id === item.user_id);
    return `<tr>${cells([user ? userLabel(user) : item.user_id, item.reason || '-'])}</tr>`;
  }).join('')) : `<div class="chat-admin-empty">${escapeHtml(t(directoryLoaded ? 'noBlacklist' : 'quotaNotLoaded'))}</div>`;
}
function quotaSummary(period, item) {
  return `<div class="chat-admin-quota-period"><strong>${escapeHtml(t(`quotaPeriod.${period}`))}</strong><span>${escapeHtml(t('quotaSummary', {limit: quotaValue(item.limit), used: item.used ?? '-', remaining: quotaValue(item.remaining), reset: formatTime(item.resets_at)}))}</span></div>`;
}
function renderQuota() {
  $('globalQuotaSummary').innerHTML = globalQuota ? quotaSummary('day', {...globalQuota, limit: globalQuota.daily_limit}) : escapeHtml(t('quotaNotLoaded'));
  $('userQuotaSummary').innerHTML = userQuota ? asArray(userQuota.periods).filter(item => ['day', 'week', 'month'].includes(item.period)).map(item => quotaSummary(item.period, item)).join('') : escapeHtml(t(selectedUser ? 'quotaNotLoaded' : 'selectUser'));
  const user = directory.find(item => item.user_id === selectedUser);
  $('quotaUserState').textContent = user ? `${userLabel(user)} · ${t(user.bound ? 'memberBound' : 'memberUnbound')}${userQuota ? ` · ${t(userQuota.blacklisted ? 'blockedState' : 'allowedState')}` : ''}` : '';
}
function fillGlobalQuota() { $('globalDailyLimit').value = globalQuota?.daily_limit ?? ''; }
function fillUserQuota() {
  for (const [id, field] of [['userDailyLimit', 'daily_limit'], ['userWeeklyLimit', 'weekly_limit'], ['userMonthlyLimit', 'monthly_limit']]) $(id).value = userQuota?.user?.[field] ?? '';
  $('userBlacklisted').checked = userQuota?.blacklisted === true;
  $('blacklistReason').value = userQuota?.reason ?? '';
}
function assertSelection(run, userId, revision) {
  assertCurrent(run);
  if (selectedUser !== userId || selectionEpoch !== revision) throw new DOMException('Stale user selection', 'AbortError');
}
async function loadQuota(run, userId = selectedUser, revision = selectionEpoch) {
  const snapshot = await request(run, 'admin_quota_get', {user_id: userId || null});
  assertSelection(run, userId, revision);
  globalQuota = snapshot.global; fillGlobalQuota();
  if (userId) { userQuota = snapshot; fillUserQuota(); }
  renderQuota(); controls();
}
async function loadQuotaDirectory(run) {
  setMessage('quotaMessage', 'loading');
  const payload = await request(run, 'admin_user_directory');
  assertCurrent(run);
  directory = asArray(payload.users); blacklist = asArray(payload.blacklist); directoryLoaded = true;
  if (selectedUser && !directory.some(item => item.user_id === selectedUser)) {
    selectedUser = ''; selectionEpoch++; userQuota = null; fillUserQuota();
  }
  renderQuotaDirectory(); renderQuota();
  await loadQuota(run);
  setMessage('quotaMessage');
}
function quotaInput(id) {
  const raw = $(id).value.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!validInteger(value, 0, 1000000000000)) throw new Error('quota_input');
  return value;
}
async function saveQuota(run, messageId, userId, revision, action, body) {
  setMessage(messageId, 'saving');
  let snapshot;
  try { snapshot = await request(run, action, body); }
  catch (error) {
    assertSelection(run, userId, revision);
    if (error.status !== 409 || error.message !== 'conflict') throw error;
    // Never retry a stale version automatically. Reload the server values for review.
    setMessage(messageId, 'quotaConflict', 'warning');
    await loadQuota(run, userId, revision);
    return;
  }
  assertSelection(run, userId, revision);
  globalQuota = snapshot.global; fillGlobalQuota();
  if (body.user_id) {
    userQuota = snapshot; fillUserQuota();
    blacklist = blacklist.filter(item => item.user_id !== userId);
    if (snapshot.blacklisted) blacklist.push({user_id: userId, reason: snapshot.reason || ''});
    renderQuotaDirectory();
  }
  renderQuota();
  setMessage(messageId, 'quotaSaved', 'success');
}
function testResultState(status, quotaLimited) {
  if (status === 'incomplete' && quotaLimited) return ['testQuotaTruncated', 'warning'];
  return ({success: ['testComplete', 'success'], incomplete: ['testIncomplete', 'warning'], interrupted: ['testInterrupted', 'warning'], failure: ['testFailure', 'error']})[status] || ['testFailure', 'error'];
}
async function refreshTestQuota(run, userId, revision) {
  try { await loadQuota(run, userId, revision); }
  catch (error) {
    assertCurrent(run);
    if (error.name === 'AbortError') return;
    if (error.status === 401 || error.status === 403) throw error;
    setMessage('quotaMessage', errorKey(error), 'error');
  }
}
function refreshLocalizedUi() {
  window.ClubI18n?.apply(document);
  renderProviderOptions(); renderModelOptions(); renderProviders(); renderModels(); renderUsage(); renderQuotaDirectory(); renderQuota(); renderProxy();
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
  usage = {rows, page: query.page, pageSize: query.pageSize, total: Number.isFinite(payload.total) ? payload.total : null, summary: payload.summary ?? null, loaded: true};
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
  try { await loadProxy(run); setMessage('proxyMessage'); }
  catch (error) {
    assertCurrent(run);
    if (error.status === 401 || error.status === 403) throw error;
    setMessage('proxyMessage', errorKey(error), 'error');
  }
  try { await loadQuotaDirectory(run); }
  catch (error) {
    assertCurrent(run);
    if (error.status === 401 || error.status === 403) throw error;
    setMessage('quotaMessage', errorKey(error), 'error');
  }
  if ($('accessModel').value) {
    modelAccessModelId = $('accessModel').value;
    modelAccessEpoch++;
    try { await loadModelAccess(run, modelAccessModelId, modelAccessEpoch); }
    catch (error) {
      assertCurrent(run);
      if (error.status === 401 || error.status === 403) throw error;
      setMessage('modelAccessMessage', errorKey(error), 'error');
    }
  }
  try { await loadUsage(run); setMessage('usageMessage'); }
  catch (error) {
    assertCurrent(run);
    if (error.status === 401 || (error.status === 403 && !blockedTest(error))) throw error;
    setMessage('usageMessage', error.message === 'date' ? 'invalidDates' : errorKey(error), 'error');
  }
}
function clearProvider() { $('providerForm').reset(); $('providerId').value = ''; $('providerApiProtocol').value = 'auto'; }
function syncDefaultOutputMax() { $('defaultOutputTokens').max = String(Math.min(131072, Math.max(1, Number($('maxOutputTokens').value) || 1))); }
function clearModel() { $('modelForm').reset(); $('modelConfigId').value = ''; syncDefaultOutputMax(); fillClaudeThinking(null); }
function clearSensitive() {
  clearProxyPlaintext(); proxyRoutes = []; proxyKeys = []; proxyLoaded = false;
  clearProxyRoute(); $('proxyKeyForm').reset(); $('proxyKeyLabel').value = ''; $('proxyKeyRoute').replaceChildren();
  providers = []; models = []; usage = emptyUsage(); testOutput = {visible: false, text: ''};
  directory = []; blacklist = []; directoryLoaded = false; selectedUser = ''; selectionEpoch++;
  modelAccess = null; modelAccessDraft = null; modelAccessModelId = ''; modelAccessEpoch++;
  globalQuota = null; userQuota = null; fillGlobalQuota(); fillUserQuota();
  $('quotaUser').replaceChildren();
  clearProvider(); clearModel(); $('testForm').reset(); $('usageFilter').reset();
  $('modelProvider').replaceChildren(); $('testModel').replaceChildren();
  messages.clear();
  for (const id of ['statusHint', 'gateMessage', 'providerMessage', 'modelMessage', 'testMessage', 'usageMessage', 'quotaMessage', 'globalQuotaMessage', 'userQuotaMessage', 'blacklistMessage', 'proxyMessage', 'proxyCopyMessage']) setMessage(id);
  for (const id of ['providerCount', 'modelCount', 'usageCount', 'totalTokens']) $(id).textContent = '--';
  refreshLocalizedUi();
}
function proxyBaseURL(id) { return `${SUPABASE_URL}/functions/v1/chat-api-proxy/${encodeURIComponent(id)}/v1`; }
function clearProxyPlaintext() {
  proxyPlaintext = '';
  $('proxyOneTimeKey').textContent = '';
  $('proxyOneTimePanel').hidden = true;
  setMessage('proxyCopyMessage');
}
function clearProxyRoute() {
  $('proxyRouteForm').reset(); $('proxyRouteId').value = ''; proxyEditingVersion = 0;
}
function fillProxyRoute(item) {
  $('proxyRouteId').value = item.id; proxyEditingVersion = item.version;
  $('proxyRouteName').value = item.name; $('proxyBaseUrl').value = item.base_url;
  $('proxySecretName').value = item.secret_name; $('proxyRouteEnabled').checked = item.enabled;
}
function validProviderUrl(value) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, '');
  const base = path.replace(/\/(?:responses|messages?|chat\/completions)$/i, '');
  if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || /%|\\/.test(path) || /(^|\/)(?:responses?|messages?|chat\/completions)(\/|$)/i.test(base)) throw new Error('provider_url');
  return url;
}
function proxyRouteInput() {
  const body = {id: $('proxyRouteId').value || null, name: $('proxyRouteName').value.trim(), base_url: $('proxyBaseUrl').value.trim(), secret_name: $('proxySecretName').value.trim(), enabled: $('proxyRouteEnabled').checked, expected_version: proxyEditingVersion};
  if (!body.name || body.name.length > 120) throw new Error('input');
  if (!/^CHAT_KEY_[A-Z0-9_]{1,80}$/.test(body.secret_name)) throw new Error('secret_name');
  try { validProviderUrl(body.base_url); }
  catch { throw new Error('proxy_url'); }
  return body;
}
function proxyAction(attribute, id, label, danger = false) {
  return `<button class="chat-admin-button ${danger ? 'chat-admin-danger' : 'chat-admin-secondary'}" type="button" ${attribute}="${escapeHtml(id)}">${escapeHtml(t(label))}</button>`;
}
function renderProxyExample() {
  const id = $('proxyKeyRoute').value;
  $('proxyExample').textContent = JSON.stringify({baseURL: id ? proxyBaseURL(id) : `${SUPABASE_URL}/functions/v1/chat-api-proxy/<route-id>/v1`, apiKey: '<YOUR_PROXY_API_KEY>', method: 'POST', endpoint: '/responses', body: {model: '<UPSTREAM_MODEL_ID>', input: 'Hello'}}, null, 2);
}
function renderProxy() {
  const previous = $('proxyKeyRoute').value;
  $('proxyKeyRoute').replaceChildren(new Option(t('proxySelectRoute'), ''));
  for (const item of proxyRoutes.filter(item => !item.deleted_at)) $('proxyKeyRoute').add(new Option(`${item.name}${item.enabled ? '' : ` · ${t('disabledBadge')}`}`, item.id));
  if (proxyRoutes.some(item => item.id === previous && !item.deleted_at)) $('proxyKeyRoute').value = previous;
  $('proxyRoutesList').innerHTML = proxyRoutes.length ? table(['proxyName', 'baseUrl', 'secretName', 'proxyClientBase', 'enabled', 'proxyVersion', 'startedAt', 'proxyUpdated', 'proxyActions'], proxyRoutes.map(item => `<tr>${cells([item.name, item.base_url, item.secret_name, proxyBaseURL(item.id)])}<td>${item.deleted_at ? escapeHtml(t('proxyDeleted')) : badge(item.enabled)}</td>${cells([item.version, formatTime(item.created_at), formatTime(item.updated_at)])}<td><div class="chat-admin-actions">${proxyAction('data-proxy-copy-base', item.id, 'proxyCopyBase')}${item.deleted_at ? '' : proxyAction('data-proxy-edit', item.id, 'edit')}${item.deleted_at ? '' : proxyAction('data-proxy-route-state', item.id, item.enabled ? 'proxyDisable' : 'proxyEnable')}${item.deleted_at ? proxyAction('data-proxy-route-hard-delete', item.id, 'proxyHardDeleteRoute', true) : proxyAction('data-proxy-route-delete', item.id, 'proxyDelete', true)}</div></td></tr>`).join('')) : `<div class="chat-admin-empty">${escapeHtml(t(proxyLoaded ? 'proxyNoRoutes' : 'proxyNotLoaded'))}</div>`;
  $('proxyKeysList').innerHTML = proxyKeys.length ? table(['proxyRoute', 'proxyKeyLabel', 'proxyKeyMask', 'status', 'proxyVersion', 'startedAt', 'proxyRevokedAt', 'proxyActions'], proxyKeys.map(item => {
    const route = proxyRoutes.find(route => route.id === item.route_id);
    return `<tr>${cells([route?.name || item.route_id, item.label, `${item.key_prefix}…${item.key_last4}`])}<td>${item.revoked_at ? escapeHtml(t('proxyRevoked')) : badge(item.enabled)}</td>${cells([item.version, formatTime(item.created_at), formatTime(item.revoked_at)])}<td><div class="chat-admin-actions">${item.revoked_at ? proxyAction('data-proxy-key-hard-delete', item.id, 'proxyHardDeleteKey', true) : `${proxyAction('data-proxy-key-state', item.id, item.enabled ? 'proxyDisable' : 'proxyEnable')}${proxyAction('data-proxy-key-revoke', item.id, 'proxyRevoke', true)}`}</div></td></tr>`;
  }).join('')) : `<div class="chat-admin-empty">${escapeHtml(t(proxyLoaded ? 'proxyNoKeys' : 'proxyNotLoaded'))}</div>`;
  renderProxyExample();
}
// Explicit safe-field projection: never keep a list response's unexpected key/hash fields.
function safeProxyKey(item) {
  return Object.fromEntries(['id', 'route_id', 'label', 'key_prefix', 'key_last4', 'enabled', 'revoked_at', 'version', 'created_at'].map(field => [field, item[field]]));
}
async function loadProxy(run) {
  const payload = await request(run, 'admin_proxy_list', {});
  assertCurrent(run);
  proxyRoutes = asArray(payload.routes); proxyKeys = asArray(payload.keys).map(safeProxyKey); proxyLoaded = true;
  renderProxy(); controls();
}
async function proxyMutation(run, action, body) {
  setMessage('proxyMessage', 'saving');
  let payload;
  try { payload = await request(run, action, body); }
  catch (error) {
    assertCurrent(run);
    if (error.status !== 409 || !['conflict', 'not_revoked'].includes(error.message)) throw error;
    await loadProxy(run);
    const editing = proxyRoutes.find(item => item.id === $('proxyRouteId').value && !item.deleted_at);
    if (editing) fillProxyRoute(editing); else clearProxyRoute();
    setMessage('proxyMessage', error.message === 'not_revoked' ? 'proxyNotRevoked' : 'proxyConflict', 'warning');
    return;
  }
  assertCurrent(run);
  if (payload.route) {
    proxyRoutes = proxyRoutes.filter(item => item.id !== payload.route.id).concat(payload.route);
    if (action === 'admin_proxy_save') clearProxyRoute();
    else if (action === 'admin_proxy_route_delete') {
      if ($('proxyRouteId').value === payload.route.id) clearProxyRoute();
      if ($('proxyKeyRoute').value === payload.route.id) $('proxyKeyRoute').value = '';
    } else if ($('proxyRouteId').value === payload.route.id) fillProxyRoute(payload.route);
  }
  if (action === 'admin_proxy_route_hard_delete' && payload.deleted_route_id) {
    proxyRoutes = proxyRoutes.filter(item => item.id !== payload.deleted_route_id);
    proxyKeys = proxyKeys.filter(item => item.route_id !== payload.deleted_route_id);
    if ($('proxyRouteId').value === payload.deleted_route_id) clearProxyRoute();
    if ($('proxyKeyRoute').value === payload.deleted_route_id) $('proxyKeyRoute').value = '';
  }
  if (action === 'admin_proxy_key_hard_delete' && payload.deleted_key_id) {
    proxyKeys = proxyKeys.filter(item => item.id !== payload.deleted_key_id);
  }
  if (payload.key) proxyKeys = proxyKeys.filter(item => item.id !== payload.key.id).concat(safeProxyKey(payload.key));
  if (action === 'admin_proxy_route_delete') await loadProxy(run);
  if (action === 'admin_proxy_key_create') {
    clearProxyPlaintext();
    if (typeof payload.api_key === 'string' && payload.api_key) {
      proxyPlaintext = payload.api_key;
      $('proxyOneTimeKey').textContent = proxyPlaintext; $('proxyOneTimePanel').hidden = false;
    }
    $('proxyKeyLabel').value = '';
  }
  const successKey = ({admin_proxy_route_delete: 'proxyDeleteSuccess', admin_proxy_route_hard_delete: 'proxyHardDeleteRouteSuccess', admin_proxy_key_hard_delete: 'proxyHardDeleteKeySuccess'})[action] || 'proxySaved';
  renderProxy(); setMessage('proxyMessage', successKey, 'success');
}
async function copyProxyPlaintext() {
  if (!authorized || !proxyPlaintext) return;
  const revision = epoch;
  try {
    // Pass the in-memory value only to the explicit user-initiated clipboard write.
    await navigator.clipboard.writeText(proxyPlaintext);
    if (revision === epoch && authorized && proxyPlaintext) setMessage('proxyCopyMessage', 'proxyCopied', 'success');
  } catch { if (revision === epoch && authorized && proxyPlaintext) setMessage('proxyCopyMessage', 'proxyCopyFailed', 'error'); }
}
async function copyProxyBase(id) {
  if (!authorized || !proxyRoutes.some(item => item.id === id)) return;
  const revision = epoch;
  try {
    await navigator.clipboard.writeText(proxyBaseURL(id));
    if (revision === epoch && authorized) setMessage('proxyMessage', 'proxyBaseCopied', 'success');
  } catch { if (revision === epoch && authorized) setMessage('proxyMessage', 'proxyCopyFailed', 'error'); }
}
function validInteger(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }

/* 删除供应商：会连带删除其下全部模型，因此确认文案必须写明数量。 */
async function removeProvider(item) {
  if (active || !authorized || !item) return;
  const children = models.filter(row => row.provider_id === item.id).length;
  if (!window.confirm(t('providerDeleteConfirm', {name: item.label || item.name, n: children}))) return;
  const messageId = 'providerMessage';
  void operation(messageId, async run => {
    setMessage(messageId, 'deleting');
    await request(run, 'admin_delete_provider', {id: item.id}); assertCurrent(run);
    // 若正在编辑这条供应商，清空表单避免继续往已删除记录上保存。
    if ($('providerId').value === item.id) clearProvider();
    await loadAdmin(run);
    setMessage(messageId, 'providerDeleted', 'success', {n: children});
  });
}

/* 删除模型：只影响这一条，但会让正在编辑/测试它的表单失效。 */
async function removeModel(item) {
  if (active || !authorized || !item) return;
  if (!window.confirm(t('modelDeleteConfirm', {name: item.display_name || modelKey(item)}))) return;
  const messageId = 'modelMessage';
  void operation(messageId, async run => {
    setMessage(messageId, 'deleting');
    await request(run, 'admin_delete_model', {id: item.id, expected_version: Number(item.version) || 0}); assertCurrent(run);
    if ($('modelConfigId').value === item.id) clearModel();
    await loadAdmin(run);
    setMessage(messageId, 'modelDeleted', 'success');
  });
}

$('refreshQuotaButton').onclick = () => void operation('quotaMessage', loadQuotaDirectory);
$('refreshProxyButton').onclick = () => void operation('proxyMessage', async run => { await loadProxy(run); setMessage('proxyMessage'); });
$('clearProxyRouteButton').onclick = () => { if (!active) clearProxyRoute(); };
$('clearProxyKeyButton').onclick = () => { clearProxyPlaintext(); controls(); };
$('copyProxyKeyButton').onclick = () => void copyProxyPlaintext();
$('proxyKeyRoute').addEventListener('change', () => { renderProxyExample(); controls(); });
$('proxyRouteForm').addEventListener('submit', event => {
  event.preventDefault();
  if (active || !authorized || !$('proxyRouteForm').reportValidity()) return;
  let body;
  try { body = proxyRouteInput(); } catch (error) { setMessage('proxyMessage', errorKey(error), 'error'); return; }
  void operation('proxyMessage', run => proxyMutation(run, 'admin_proxy_save', body));
});
$('proxyKeyForm').addEventListener('submit', event => {
  event.preventDefault();
  if (active || !authorized || !$('proxyKeyForm').reportValidity()) return;
  const route_id = $('proxyKeyRoute').value, label = $('proxyKeyLabel').value.trim();
  if (!proxyRoutes.some(item => item.id === route_id) || !label || label.length > 120) return setMessage('proxyMessage', 'invalidInput', 'error');
  // Do not silently replace a key the administrator has not yet saved.
  if (proxyPlaintext && !window.confirm(t('proxyReplaceConfirm'))) return;
  clearProxyPlaintext();
  void operation('proxyMessage', run => proxyMutation(run, 'admin_proxy_key_create', {route_id, label}));
});
$('proxyRoutesList').addEventListener('click', event => {
  if (active || !authorized) return;
  const button = event.target.closest('[data-proxy-copy-base], [data-proxy-edit], [data-proxy-route-state], [data-proxy-route-delete], [data-proxy-route-hard-delete]');
  if (!button) return;
  const item = proxyRoutes.find(item => item.id === (button.dataset.proxyCopyBase || button.dataset.proxyEdit || button.dataset.proxyRouteState || button.dataset.proxyRouteDelete || button.dataset.proxyRouteHardDelete));
  if (!item) return;
  if (button.dataset.proxyCopyBase) { void copyProxyBase(item.id); return; }
  if (button.dataset.proxyRouteHardDelete) {
    if (!item.deleted_at || !window.confirm(t('proxyHardDeleteRouteConfirm', {name: item.name}))) return;
    void operation('proxyMessage', run => proxyMutation(run, 'admin_proxy_route_hard_delete', {id: item.id, expected_version: item.version}));
    return;
  }
  if (item.deleted_at) return;
  if (button.dataset.proxyEdit) { fillProxyRoute(item); $('proxyRouteName').focus(); return; }
  if (button.dataset.proxyRouteDelete) {
    if (!window.confirm(t('proxyDeleteConfirm', {name: item.name}))) return;
    void operation('proxyMessage', run => proxyMutation(run, 'admin_proxy_route_delete', {id: item.id, expected_version: item.version}));
    return;
  }
  void operation('proxyMessage', run => proxyMutation(run, 'admin_proxy_route_state', {id: item.id, enabled: !item.enabled, expected_version: item.version}));
});
$('proxyKeysList').addEventListener('click', event => {
  if (active || !authorized) return;
  const button = event.target.closest('[data-proxy-key-state], [data-proxy-key-revoke], [data-proxy-key-hard-delete]');
  const item = proxyKeys.find(item => item.id === (button?.dataset.proxyKeyState || button?.dataset.proxyKeyRevoke || button?.dataset.proxyKeyHardDelete));
  if (!item) return;
  if (button.dataset.proxyKeyHardDelete) {
    if (!item.revoked_at || !window.confirm(t('proxyHardDeleteKeyConfirm', {label: item.label}))) return;
    void operation('proxyMessage', run => proxyMutation(run, 'admin_proxy_key_hard_delete', {id: item.id, expected_version: item.version}));
    return;
  }
  if (item.revoked_at) return;
  const revoked = Boolean(button.dataset.proxyKeyRevoke);
  if (revoked && !window.confirm(t('proxyRevokeConfirm', {label: item.label}))) return;
  void operation('proxyMessage', run => proxyMutation(run, 'admin_proxy_key_state', {id: item.id, enabled: revoked ? false : !item.enabled, revoked, expected_version: item.version}));
});
$('quotaUserForm').addEventListener('submit', event => event.preventDefault());
$('accessModel').addEventListener('change', () => {
  if (active || !authorized) return;
  modelAccessModelId = $('accessModel').value; modelAccessEpoch++; modelAccess = null; modelAccessDraft = null; renderAccessUsers();
  if (modelAccessModelId) void operation('modelAccessMessage', async run => { setMessage('modelAccessMessage', 'loading'); await loadModelAccess(run, modelAccessModelId, modelAccessEpoch); setMessage('modelAccessMessage'); });
});
$('accessVisibility').addEventListener('change', () => {
  if (!modelAccess) { $('accessVisibility').value = 'all'; return; }
  modelAccessDraft = {...modelAccessDraft, visibility: $('accessVisibility').value};
});
$('accessSelectAll').onclick = () => {
  if (!modelAccess) return;
  const user_ids = directory.map(item => item.user_id);
  modelAccessDraft = {...modelAccessDraft, user_ids};
  document.querySelectorAll('[data-access-user]').forEach(node => { node.checked = true; });
};
$('refreshAccessButton').onclick = () => {
  if (active || !authorized || !modelAccessModelId) return;
  modelAccessEpoch++;
  void operation('modelAccessMessage', async run => { setMessage('modelAccessMessage', 'loading'); await loadModelAccess(run, modelAccessModelId, modelAccessEpoch); setMessage('modelAccessMessage'); });
};
$('modelAccessForm').addEventListener('submit', event => {
  event.preventDefault();
  if (active || !authorized || !modelAccess || !$('modelAccessForm').reportValidity()) return;
  const modelId = modelAccessModelId, revision = modelAccessEpoch;
  const visibility = $('accessVisibility').value;
  const user_ids = visibility === 'all' ? [] : [...document.querySelectorAll('[data-access-user]:checked')].map(node => node.dataset.accessUser);
  modelAccessDraft = {visibility, user_ids};
  const body = {model_id: modelId, visibility, user_ids, expected_version: modelAccess.version};
  void operation('modelAccessMessage', run => saveModelAccess(run, modelId, revision, body));
});
$('accessUsers').addEventListener('change', event => {
  if (active || !authorized || !event.target.matches('[data-access-user]')) return;
  if (!modelAccess) { event.target.checked = false; return; }
  modelAccessDraft = {...modelAccessDraft, user_ids: [...document.querySelectorAll('[data-access-user]:checked')].map(node => node.dataset.accessUser)};
});
$('quotaUser').addEventListener('change', () => {
  if (active || !authorized) { $('quotaUser').value = selectedUser; return; }
  selectedUser = $('quotaUser').value; selectionEpoch++; userQuota = null; fillUserQuota();
  for (const id of ['userQuotaMessage', 'blacklistMessage']) setMessage(id);
  renderQuota(); controls();
  if (selectedUser) void operation('userQuotaMessage', async run => {
    setMessage('userQuotaMessage', 'loading'); await loadQuota(run); setMessage('userQuotaMessage');
  });
});
for (const [formId, messageId, global] of [['globalQuotaForm', 'globalQuotaMessage', true], ['userQuotaForm', 'userQuotaMessage', false]]) {
  $(formId).addEventListener('submit', event => {
    event.preventDefault();
    if (active || !authorized || !$(formId).reportValidity() || !globalQuota || (!global && !userQuota)) return;
    let body;
    try {
      body = global ? {user_id: null, daily_limit: quotaInput('globalDailyLimit'), expected_version: globalQuota.version} : {
        user_id: selectedUser, daily_limit: quotaInput('userDailyLimit'), weekly_limit: quotaInput('userWeeklyLimit'), monthly_limit: quotaInput('userMonthlyLimit'), expected_version: userQuota.user.version
      };
    } catch { setMessage(messageId, 'invalidQuota', 'error'); return; }
    const userId = selectedUser, revision = selectionEpoch;
    void operation(messageId, run => saveQuota(run, messageId, userId, revision, 'admin_quota_save', body));
  });
}
$('blacklistForm').addEventListener('submit', event => {
  event.preventDefault();
  if (active || !authorized || !selectedUser || !userQuota || !$('blacklistForm').reportValidity()) return;
  const userId = selectedUser, revision = selectionEpoch;
  const body = {user_id: userId, blocked: $('userBlacklisted').checked, reason: $('blacklistReason').value.trim()};
  if (body.reason.length > 1000) return setMessage('blacklistMessage', 'invalidInput', 'error');
  void operation('blacklistMessage', run => saveQuota(run, 'blacklistMessage', userId, revision, 'admin_set_blacklist', body));
});
$('providersList').addEventListener('click', event => {
  if (active || !authorized) return;
  const deleteHit = event.target.closest('[data-delete-provider]');
  if (deleteHit) {
    const target = providers.find(row => row.id === deleteHit.dataset.deleteProvider);
    if (target) void removeProvider(target);
    return;
  }
  const button = event.target.closest('[data-edit-provider]');
  const item = providers.find(row => row.id === button?.dataset.editProvider);
  if (!item) return;
  $('providerId').value = item.id; $('providerName').value = item.name;
  $('providerLabel').value = item.label || ''; $('providerBaseUrl').value = item.base_url;
  $('providerApiProtocol').value = providerApiProtocol(item);
  $('providerSecretName').value = item.secret_name; $('providerAuthHeader').value = item.auth_header || 'authorization';
  $('providerEnabled').checked = item.enabled !== false; setMessage('providerMessage'); $('providerName').focus();
});
$('modelsList').addEventListener('click', event => {
  if (active || !authorized) return;
  const deleteHit = event.target.closest('[data-delete-model]');
  if (deleteHit) {
    const target = models.find(row => row.id === deleteHit.dataset.deleteModel);
    if (target) void removeModel(target);
    return;
  }
  const button = event.target.closest('[data-edit-model]');
  const item = models.find(row => row.id === button?.dataset.editModel);
  if (!item) return;
  $('modelConfigId').value = item.id; $('modelId').value = modelKey(item);
  $('modelLabel').value = item.display_name; $('modelIntroduction').value = item.introduction || ''; $('modelProvider').value = item.provider_id;
  $('contextWindow').value = item.context_window; $('maxOutputTokens').value = item.max_output_tokens;
  $('defaultOutputTokens').value = item.default_max_output_tokens; syncDefaultOutputMax();
  $('reasoningEfforts').value = asArray(item.reasoning_efforts).join(','); $('defaultReasoning').value = item.default_reasoning_effort || '';
  $('supportsImages').checked = item.supports_images === true; $('supportsPdf').checked = item.supports_pdf === true;
  $('preserveReasoning').checked = item.preserve_reasoning === true; $('modelEnabled').checked = item.enabled !== false;
  fillClaudeThinking(item);
  setMessage('modelMessage'); $('modelId').focus();
});

$('providerForm').addEventListener('submit', event => {
  event.preventDefault();
  if (active || !authorized || !$('providerForm').reportValidity()) return;
  const body = {id: $('providerId').value || null, name: $('providerName').value.trim(), label: $('providerLabel').value.trim(), base_url: $('providerBaseUrl').value.trim(), api_protocol: $('providerApiProtocol').value, secret_name: $('providerSecretName').value.trim(), auth_header: $('providerAuthHeader').value, enabled: $('providerEnabled').checked};
  if (!API_PROTOCOLS.includes(body.api_protocol)) return setMessage('providerMessage', 'invalidApiProtocol', 'error');
  if (!body.name || body.name.length > 80 || body.label.length > 120) return setMessage('providerMessage', 'providerRequired', 'error');
  if (!/^CHAT_KEY_[A-Z0-9_]{1,80}$/.test(body.secret_name)) return setMessage('providerMessage', 'invalidSecret', 'error');
  try { validProviderUrl(body.base_url); }
  catch { return setMessage('providerMessage', 'invalidUrl', 'error'); }
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
  const body = {id: $('modelConfigId').value || null, model_key: $('modelId').value.trim(), display_name: $('modelLabel').value.trim(), introduction: $('modelIntroduction').value.trim() || null, provider_id: $('modelProvider').value, context_window: Number($('contextWindow').value), max_output_tokens: Number($('maxOutputTokens').value), default_max_output_tokens: Number($('defaultOutputTokens').value), reasoning_efforts: efforts, default_reasoning_effort: $('defaultReasoning').value.trim() || null, supports_images: $('supportsImages').checked, supports_pdf: $('supportsPdf').checked, preserve_reasoning: $('preserveReasoning').checked, enabled: $('modelEnabled').checked};
  if (!body.model_key || body.model_key.length > 160 || !body.display_name || body.display_name.length > 120 || (body.introduction && body.introduction.length > 1000) || !body.provider_id) return setMessage('modelMessage', 'modelRequired', 'error');
  if (!validInteger(body.context_window, 256, 1000000) || !validInteger(body.max_output_tokens, 1, 131072) || !validInteger(body.default_max_output_tokens, 1, body.max_output_tokens)) return setMessage('modelMessage', 'invalidLimits', 'error');
  if (!modelUsesMessages(body) && (efforts.length > 12 || efforts.some(value => value.length > 40) || (body.default_reasoning_effort?.length || 0) > 40)) return setMessage('modelMessage', 'invalidReasoning', 'error');
  try { body.claude_thinking = claudeThinkingInput(body.default_max_output_tokens); }
  catch (error) { return setMessage('modelMessage', errorKey(error), 'error'); }
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
  if (modelUsesMessages(item) && item.claude_thinking?.mode === 'enabled' && output <= item.claude_thinking.budget_tokens) return setMessage('testMessage', 'claudeThinkingBudgetInvalid', 'error');
  if (!window.confirm(t('testConfirm'))) return;
  void operation('testMessage', async run => {
    testOutput = {visible: false, text: ''}; renderTestOutput(); setMessage('testMessage', 'testRunning');
    const quotaUserId = selectedUser, quotaRevision = selectionEpoch;
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
      const state = testResultState(result.status, response.headers.get('x-chat-quota-limited') === 'true');
      setMessage('testMessage', ...state);
    } catch (error) {
      assertCurrent(run);
      if (error.status === 401 || (error.status === 403 && !blockedTest(error))) throw error;
      testOutput.visible = true; renderTestOutput();
      setMessage('testMessage', streaming ? 'testInterrupted' : errorKey(error), streaming ? 'warning' : 'error');
    }
    await refreshTestQuota(run, quotaUserId, quotaRevision);
    try { await loadUsage(run); setMessage('usageMessage'); }
    catch (error) {
      assertCurrent(run);
      if (error.status === 401 || (error.status === 403 && !blockedTest(error))) throw error;
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
$('modelProvider').addEventListener('change', refreshThinkingControls);
$('modelClaudeThinkingMode').addEventListener('change', refreshThinkingControls);
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
