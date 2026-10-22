// Offline: node tools/test-club-donations-ui.mjs
// Runs the real inline script from public/donations.html in a stub DOM to verify
// sign-in gating, read-only vs super-admin rendering, and create/edit/delete flows.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const PAGE = new URL('../public/donations.html', import.meta.url);

const csvExports = [];

function harness({ superAdmin = false, session = { user: { id: 'u1' }, access_token: 'token' }, qrUrl = '' } = {}) {
  const html = pageSource;
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const requests = [];
  const confirms = [];
  let authHandler = null;
  let initialResolve;
  const initial = new Promise(resolve => { initialResolve = resolve; });

  const element = (id = '') => {
    const node = {
      id, value: '', textContent: '', innerHTML: '', hidden: false, className: '', dataset: {},
      classList: {
        set: new Set(),
        toggle(name, force) { if (force === undefined) { this.set.has(name) ? this.set.delete(name) : this.set.add(name); } else force ? this.set.add(name) : this.set.delete(name); },
        contains(name) { return this.set.has(name); },
        add(name) { this.set.add(name); }, remove(name) { this.set.delete(name); }
      },
      listeners: {},
      options: [],
      add(option) { this.options.push(option); if (!this.value) this.value = option.value; },
      children: [],
      append(...next) { this.children.push(...next); },
      replaceChildren(...next) { this.children = next; },
      setAttribute(key, value) { this[key] = String(value); },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      querySelectorAll() { return []; },
      reset() { this.value = ''; },
      scrollIntoView() {}
    };
    return node;
  };
  const supabaseClient = {
    auth: {
      onAuthStateChange(fn) { authHandler = fn; },
      getSession() { return initial; }
    }
  };
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
    // 页面里的 $ 是 getElementById 的简写；测试必须与页面使用同一个元素表。
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
    createElement(tag) {
      const node = { tagName: String(tag).toUpperCase(), children: [], className: '', textContent: '', src: '', alt: '' };
      node.setAttribute = (key, value) => { node[key] = String(value); };
      node.replaceChildren = (...next) => { node.children = next; };
      node.append = (...next) => { node.children.push(...next); };
      return node;
    }
  };
  const window = {
    addEventListener(type, fn) { if (type === 'club:langchange') this.langChange = fn; },
    supabase: { createClient: () => supabaseClient },
    confirm(message) { confirms.push(message); return true; },
    scrollTo() {},
    ClubI18n: { t: key => key, apply() {} },
    ClubCommon: (() => {
      const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
      return {
        escapeHtml,
        confirm: async () => true,
        scheduleUndo: options => { if (options && typeof options.commit === 'function') void options.commit({ pagehide: false }); return { cancel() {}, flush() {} }; },
        listState(container, options) {
          const kind = options && options.kind || 'loading';
          container.innerHTML = '<div class="club-common-state ' + kind + '">' + escapeHtml(options && options.message || options && options.title || '') + '</div>';
        },
        listStateHtml(kind, options) { return '<div class="club-common-state ' + kind + '">' + escapeHtml(options && options.message || '') + '</div>'; },
        handleAuthError(response, payload, fallback) { const e = new Error(payload && payload.error || fallback); e.status = response && response.status; return e; },
        exportCsv(filename, columns, rows) {
          const header = columns.map(column => column.label).join(',');
          const body = rows.map(row => columns.map(column => typeof column.value === 'function' ? column.value(row) : row[column.key]).join(','));
          csvExports.push({ filename, header, body });
          return rows.length;
        },
        paginate(items, page, pageSize) {
          const size = Math.max(1, Number(pageSize) || 20);
          const list = Array.isArray(items) ? items : [];
          const totalPages = Math.max(1, Math.ceil(list.length / size));
          const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
          const start = (current - 1) * size;
          return { items: list.slice(start, start + size), page: current, pageSize: size, total: list.length, totalPages, hasPrev: current > 1, hasNext: current < totalPages, hidden: totalPages <= 1 };
        },
        showSessionBanner() {}, ready(fn) { fn(); }, t: key => key
      };
    })(),
    ClubStaffAccess: {
      async fetchStaffAccess() { return { isSuperAdmin: superAdmin, permissions: {} }; }
    }
  };
  const context = vm.createContext({
    window, document, console,
    supabaseClient,
    ClubCommon: window.ClubCommon,
    ClubI18n: window.ClubI18n,
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'key', FUNCTION_URL: 'https://example.supabase.co/functions/v1/club-drive',
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body, headers: init.headers });
      if (body.action === 'donations_list' || body.action === 'admin_donations_list') {
        return { ok: true, json: async () => ({
          donations: [
            { id: 'a', donor_name: 'Big <script>', donated_on: '2026-09-01', amount: '900.00' },
            { id: 'b', donor_name: 'Small', donated_on: '2026-08-01', amount: '10.00' }
          ],
          settings: { payment_qr_url: qrUrl }
        }) };
      }
      if (body.action === 'admin_donation_settings_save') {
        qrUrl = typeof body.paymentQrUrl === 'string' ? body.paymentQrUrl : '';
        return { ok: true, json: async () => ({ settings: { payment_qr_url: qrUrl } }) };
      }
      if (body.action === 'admin_donations_save') {
        return { ok: true, json: async () => ({ donation: { id: body.id || 'new', donor_name: body.donorName, donated_on: body.donatedOn, amount: Number(body.amount).toFixed(2) } }) };
      }
      if (body.action === 'admin_donations_delete') return { ok: true, json: async () => ({ ok: true }) };
      return { ok: false, status: 400, json: async () => ({ error: 'unexpected' }) };
    },
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
    setTimeout, clearTimeout, Date, Number, String, Math, JSON, RegExp, Promise, Array, Object, URL
  });
  vm.runInContext(script, context, { filename: 'donations-inline.js' });
  initialResolve({ data: { session } });
  const get = id => document.getElementById(id);
  return { elements, requests, confirms, window, context, get, settle: () => new Promise(r => setTimeout(r, 0)) };
}

const pageSource = await readFile(PAGE, 'utf8');

// Signed-out: gate visible, content hidden, no data request.
{
  const ui = harness({ session: null });
  await ui.settle(); await ui.settle();
  assert.equal(ui.get('memberGate').classList.contains('active'), true);
  assert.equal(ui.get('content').classList.contains('hidden'), true);
  assert.equal(ui.requests.length, 0, 'signed-out visitors must not trigger a data read');
}

// Ordinary member: read-only call, admin panel hidden, no action column.
{
  const ui = harness({ superAdmin: false });
  await ui.settle(); await ui.settle(); await ui.settle();
  const read = ui.requests.find(r => r.body.action === 'donations_list');
  assert.ok(read, 'ordinary member must use the read action');
  assert.equal(ui.requests.some(r => r.body.action === 'admin_donations_list'), false);
  assert.equal(ui.get('adminPanel').hidden, true, 'admin form hidden for members');
  assert.equal(ui.get('content').classList.contains('hidden'), false);
  const html = ui.get('donationList').innerHTML;
  assert.match(html, /900\.00/, 'amounts render');
  assert.doesNotMatch(html, /data-edit|data-delete/, 'members must not get edit/delete buttons');
  assert.doesNotMatch(html, /<script>/, 'donor names must be HTML-escaped');
  assert.match(html, /Big &lt;script&gt;/);
  assert.equal(ui.get('roleBadge').textContent, 'donations.roleMember');
  assert.equal(ui.get('summaryCount').textContent, '2');
}

// Super-admin: admin action, editable rows, create / edit / delete flows.
{
  const ui = harness({ superAdmin: true });
  await ui.settle(); await ui.settle(); await ui.settle();
  assert.ok(ui.requests.find(r => r.body.action === 'admin_donations_list'));
  assert.equal(ui.get('adminPanel').hidden, false);
  assert.match(ui.get('donationList').innerHTML, /data-edit="a"/);
  assert.equal(ui.get('roleBadge').textContent, 'donations.roleAdmin');

  // Create
  ui.get('donorName').value = 'Alice';
  ui.get('donatedOn').value = '2026-10-20';
  ui.get('amount').value = '1234.5';
  let prevented = false;
  await ui.get('donationForm').listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const created = ui.requests.find(r => r.body.action === 'admin_donations_save');
  assert.ok(created);
  assert.equal(created.body.donorName, 'Alice');
  assert.equal(created.body.donatedOn, '2026-10-20');
  assert.equal(created.body.amount, 1234.5);
  assert.equal('id' in created.body, false, 'create omits id');
  assert.equal(ui.get('saveButton').textContent, 'donations.add', 'form resets after create');

  // Invalid input never reaches the server.
  const before = ui.requests.length;
  ui.get('donorName').value = '   ';
  await ui.get('donationForm').listeners.submit({ preventDefault() {} });
  assert.equal(ui.requests.length, before, 'empty name must not call the server');
  assert.equal(ui.get('formMessage').textContent, 'donations.nameRequired');

  ui.get('donorName').value = 'Bob';
  ui.get('amount').value = '0';
  await ui.get('donationForm').listeners.submit({ preventDefault() {} });
  assert.equal(ui.requests.length, before, 'zero amount must not call the server');
  assert.equal(ui.get('formMessage').textContent, 'donations.amountRequired');
}

// Payment QR: empty state, configured image, admin-only form, save and clear.
{
  const ui = harness({ superAdmin: false });
  await ui.settle(); await ui.settle(); await ui.settle();
  const figure = ui.get('qrFigure');
  assert.equal(figure.children.length, 1, 'empty QR shows one placeholder node');
  assert.equal(figure.children[0].textContent, 'donations.qrEmpty');
  assert.equal(ui.get('qrForm').hidden, true, 'members cannot edit the QR code');
  assert.equal(ui.requests.some(r => r.body.action === 'admin_donation_settings_save'), false);
}
{
  const ui = harness({ superAdmin: true, qrUrl: 'https://img.example.com/qr.png' });
  await ui.settle(); await ui.settle(); await ui.settle();
  const figure = ui.get('qrFigure');
  assert.equal(figure.children.length, 1);
  const img = figure.children[0];
  assert.equal(img.tagName, 'IMG');
  assert.equal(img.src, 'https://img.example.com/qr.png');
  assert.equal(img.alt, 'donations.qrAlt');
  assert.equal(ui.get('qrForm').hidden, false, 'super admin sees the QR form');
  assert.equal(ui.get('qrUrl').value, 'https://img.example.com/qr.png');

  // Invalid URL is rejected locally without a request.
  const before = ui.requests.length;
  ui.get('qrUrl').value = 'javascript:alert(1)';
  await ui.get('qrForm').listeners.submit({ preventDefault() {} });
  assert.equal(ui.requests.length, before, 'invalid QR URL must not reach the server');
  assert.equal(ui.get('qrMessage').textContent, 'donations.qrInvalid');

  // Saving a valid URL updates the image immediately.
  ui.get('qrUrl').value = 'https://img.example.com/qr2.png';
  await ui.get('qrForm').listeners.submit({ preventDefault() {} });
  await ui.settle(); await ui.settle(); await ui.settle();
  const saved = ui.requests.slice(before).find(r => r.body.action === 'admin_donation_settings_save');
  assert.ok(saved);
  assert.equal(saved.body.paymentQrUrl, 'https://img.example.com/qr2.png');
  assert.equal(ui.get('qrFigure').children[0].src, 'https://img.example.com/qr2.png');
  assert.equal(ui.get('qrMessage').textContent, 'donations.qrSaved');

  // Clearing hides the image and shows the empty placeholder.
  const beforeClear = ui.requests.length;
  ui.get('qrClearButton').listeners.click();
  await ui.settle(); await ui.settle(); await ui.settle();
  const cleared = ui.requests.slice(beforeClear).find(r => r.body.action === 'admin_donation_settings_save');
  assert.ok(cleared);
  assert.equal(cleared.body.paymentQrUrl, '');
  assert.equal(ui.get('qrFigure').children[0].textContent, 'donations.qrEmpty');
  assert.equal(ui.get('qrMessage').textContent, 'donations.qrCleared');
}

// Toolbar: search, year filter, total, CSV export, undo delete.
{
  const ui = harness({ superAdmin: true });
  await ui.settle(); await ui.settle(); await ui.settle();
  const rows = () => ui.get('donationList').innerHTML.match(/data-edit=/g)?.length || 0;
  assert.equal(rows(), 2, 'both records render before filtering');

  ui.get('donationSearch').value = 'big';
  ui.get('donationSearch').listeners.input();
  assert.equal(rows(), 1, 'name search narrows the list');
  assert.equal(ui.get('donationSummary').textContent, 'donations.filteredSummary', 'summary uses the filtered variant');
  assert.match(ui.get('donationList').innerHTML, /data-label=/, 'cells carry mobile card labels');

  ui.get('donationSearch').value = 'no-such-name';
  ui.get('donationSearch').listeners.input();
  assert.equal(rows(), 0);
  assert.match(ui.get('donationList').innerHTML, /club-common-state/, 'no-match uses the shared empty state');

  ui.get('donationSearch').value = '';
  ui.get('donationSearch').listeners.input();
  ui.get('donationYear').value = '2026';
  ui.get('donationYear').listeners.change();
  assert.equal(rows(), 2, 'year filter keeps matching records');

  const blobCalls = [];
  const originalCreate = () => ({ href: '', download: '', click() { blobCalls.push({ href: this.href, download: this.download }); } });
  ui.context.URL.createObjectURL = () => 'blob:csv';
  ui.context.URL.revokeObjectURL = () => {};
  ui.context.Blob = class { constructor(parts, options) { this.parts = parts; this.options = options; } };
  ui.context.document.createElement = tag => {
    if (tag === 'a') return originalCreate();
    const node = { tagName: String(tag).toUpperCase(), children: [], className: '', textContent: '' };
    node.setAttribute = (key, value) => { node[key] = String(value); };
    node.replaceChildren = (...next) => { node.children = next; };
    node.append = (...next) => { node.children.push(...next); };
    return node;
  };
  const before = csvExports.length;
  ui.get('exportCsv').listeners.click();
  assert.equal(csvExports.length, before + 1, 'CSV export runs once');
  const exported = csvExports.at(-1);
  assert.match(exported.filename, /^club-donations-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.ok(exported.header.includes('donations.colDonor'), 'CSV uses localized headers');
  assert.equal(exported.body.length, 2, 'CSV contains every visible row');
}

console.log('Club donations UI: sign-in gate, read-only member view, super-admin editing, escaping, client validation, payment QR states, search/year/summary, CSV export and undo delete passed.');
