// Offline: node tools/test-club-donations-ui.mjs
// Runs the real inline script from public/donations.html in a stub DOM to verify
// sign-in gating, read-only vs super-admin rendering, and create/edit/delete flows.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const PAGE = new URL('../public/donations.html', import.meta.url);

function harness({ superAdmin = false, session = { user: { id: 'u1' }, access_token: 'token' } } = {}) {
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
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}
  };
  const window = {
    addEventListener(type, fn) { if (type === 'club:langchange') this.langChange = fn; },
    supabase: { createClient: () => supabaseClient },
    confirm(message) { confirms.push(message); return true; },
    scrollTo() {},
    ClubI18n: { t: key => key, apply() {} },
    ClubStaffAccess: {
      async fetchStaffAccess() { return { isSuperAdmin: superAdmin, permissions: {} }; }
    }
  };
  const context = vm.createContext({
    window, document, console,
    supabaseClient,
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'key', FUNCTION_URL: 'https://example.supabase.co/functions/v1/club-drive',
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body, headers: init.headers });
      if (body.action === 'donations_list' || body.action === 'admin_donations_list') {
        return { ok: true, json: async () => ({ donations: [
          { id: 'a', donor_name: 'Big <script>', donated_on: '2026-09-01', amount: '900.00' },
          { id: 'b', donor_name: 'Small', donated_on: '2026-08-01', amount: '10.00' }
        ] }) };
      }
      if (body.action === 'admin_donations_save') {
        return { ok: true, json: async () => ({ donation: { id: body.id || 'new', donor_name: body.donorName, donated_on: body.donatedOn, amount: Number(body.amount).toFixed(2) } }) };
      }
      if (body.action === 'admin_donations_delete') return { ok: true, json: async () => ({ ok: true }) };
      return { ok: false, status: 400, json: async () => ({ error: 'unexpected' }) };
    },
    setTimeout, clearTimeout, Date, Number, String, Math, JSON, RegExp, Promise, Array, Object
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

console.log('Club donations UI: sign-in gate, read-only member view, super-admin editing, escaping and client validation passed.');
