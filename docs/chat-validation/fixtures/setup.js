(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  async function local(resource, options) {
    const response = await fetch(resource,{cache:'no-store',...options});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'mock_request');
    return value;
  }
  function applyTheme(mode) {
    window.ClubTheme.setMode(mode,{persist:true,syncRemote:false});
  }
  async function refreshRequests() {
    try { $('requests').textContent = JSON.stringify(await local('/mock/requests'),null,2); }
    catch (error) { $('requests').textContent = `MOCK 服务不可用：${error.message}`; }
  }
  async function save(reset = false) {
    const payload = {account:$('account').value,scenario:$('scenario').value,theme:$('theme').value,reset};
    try {
      const state = await local('/mock/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      applyTheme(state.theme);
      $('status').textContent = `MOCK 已应用：${state.account} / ${state.scenario} / ${state.theme}。账号切换将自动通知已打开页面；主题请刷新目标页。${reset ? '服务器内存已重置，浏览器会话仍保留。' : ''}`;
      await refreshRequests();
    } catch (error) { $('status').textContent = `MOCK 设置失败：${error.message}`; }
  }
  $('setupForm').addEventListener('submit',event => { event.preventDefault(); void save(); });
  $('reset').onclick = () => void save(true);
  $('refreshRequests').onclick = () => void refreshRequests();
  local('/mock/session').then(state => {
    for (const key of ['account','scenario','theme']) $(key).value = state[key];
    applyTheme(state.theme);
    $('status').textContent = `MOCK 当前设置：${state.account} / ${state.scenario} / ${state.theme}`;
  }).catch(error => { $('status').textContent = `MOCK 服务不可用：${error.message}`; });
})();
