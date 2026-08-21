(() => {
  const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/club-drive`;

  function usernameFromSession(session) {
    const email = session?.user?.email || '';
    return email.includes('@') ? email.split('@')[0] : '';
  }

  function emptyPermissions() {
    return {
      can_checkin: false,
      can_points: false,
      can_messages: false,
      can_invites: false,
      can_events: false
    };
  }

  function hasStaffAccess(access) {
    if (!access) return false;
    if (access.isSuperAdmin) return true;
    const permissions = access.permissions || {};
    return Boolean(
      permissions.can_checkin
      || permissions.can_points
      || permissions.can_messages
      || permissions.can_invites
      || permissions.can_events
    );
  }

  async function fetchStaffAccess(session) {
    if (!session?.user?.id || !session?.access_token) {
      return { isSuperAdmin: false, permissions: emptyPermissions() };
    }
    try {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action: 'staff_access_get' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { isSuperAdmin: false, permissions: emptyPermissions() };
      }
      return {
        isSuperAdmin: Boolean(payload.isSuperAdmin),
        permissions: {
          ...emptyPermissions(),
          ...(payload.permissions || {})
        }
      };
    } catch (_error) {
      return { isSuperAdmin: false, permissions: emptyPermissions() };
    }
  }

  function applyAdminVisibility(visible) {
    document.querySelectorAll('[data-admin-only]').forEach((element) => {
      element.classList.toggle('is-visible', visible);
      if (visible) element.removeAttribute('hidden');
      else element.setAttribute('hidden', '');
    });
  }

  async function updateIdentity(session) {
    const username = usernameFromSession(session);

    document.querySelectorAll('[data-member-identity]').forEach((element) => {
      element.textContent = username ? `社员：${username}` : '';
      element.hidden = !username;
    });

    if (!session?.user?.id) {
      applyAdminVisibility(false);
      return;
    }

    const access = await fetchStaffAccess(session);
    applyAdminVisibility(hasStaffAccess(access));
  }

  window.ClubStaffAccess = {
    emptyPermissions,
    hasStaffAccess,
    fetchStaffAccess
  };

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
