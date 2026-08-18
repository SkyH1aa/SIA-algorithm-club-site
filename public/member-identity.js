(() => {
  const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';

  function usernameFromSession(session) {
    const email = session?.user?.email || '';
    return email.includes('@') ? email.split('@')[0] : '';
  }

  function updateIdentity(session) {
    const username = usernameFromSession(session);
    document.querySelectorAll('[data-member-identity]').forEach((element) => {
      element.textContent = username ? `社员：${username}` : '';
      element.hidden = !username;
    });
  }

  function start() {
    if (!window.supabase) return;
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    client.auth.getSession().then(({ data: { session } }) => updateIdentity(session));
    client.auth.onAuthStateChange((_event, session) => updateIdentity(session));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
