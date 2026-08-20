(() => {
  const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const ADMIN_EMAILS = new Set([
    'haimingadmin@club.local',
    'collen@club.local'
  ]);

  function usernameFromSession(session) {
    const email = session?.user?.email || '';
    return email.includes('@') ? email.split('@')[0] : '';
  }

  function isAdminSession(session) {
    const email = String(session?.user?.email || '').toLowerCase();
    return ADMIN_EMAILS.has(email);
  }

  function updateIdentity(session) {
    const username = usernameFromSession(session);
    const admin = isAdminSession(session);

    document.querySelectorAll('[data-member-identity]').forEach((element) => {
      element.textContent = username ? `社员：${username}` : '';
      element.hidden = !username;
    });

    document.querySelectorAll('[data-admin-only]').forEach((element) => {
      element.classList.toggle('is-visible', admin);
      if (admin) element.removeAttribute('hidden');
      else element.setAttribute('hidden', '');
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
