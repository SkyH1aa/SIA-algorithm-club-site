(() => {
  const $ = id => document.getElementById(id);
  async function get(path, options) { const response = await fetch(path, {cache:'no-store', ...options}); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'mock_request'); return value; }
  function show(state) { for (const id of ['account','scenario','assistantAvailable','serviceEnabled','theme']) $(id).value = String(state[id]); $('state').textContent = JSON.stringify(state,null,2); }
  async function save(reset = false) {
    try { const state = await get('/mock/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:$('account').value,scenario:$('scenario').value,assistantAvailable:$('assistantAvailable').value === 'true',serviceEnabled:$('serviceEnabled').value === 'true',theme:$('theme').value,reset})}); window.ClubTheme?.setMode(state.theme,{persist:true,syncRemote:false}); show(state); $('status').textContent = `Applied: ${state.account} / ${state.scenario} / assistant ${state.assistantAvailable ? 'available' : 'unavailable'}${reset ? ' · memory reset' : ''}`; } catch (error) { $('status').textContent = `Fixture unavailable: ${error.message}`; }
  }
  $('assistantSetup').addEventListener('submit', event => { event.preventDefault(); void save(); }); $('reset').addEventListener('click', () => void save(true));
  get('/mock/session').then(state => { show(state); window.ClubTheme?.setMode(state.theme,{persist:true,syncRemote:false}); $('status').textContent = `Current: ${state.account} / ${state.scenario}`; }).catch(error => { $('status').textContent = error.message; });
})();
