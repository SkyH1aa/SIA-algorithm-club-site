(() => {
  const SUPABASE_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/club-drive`;
  // 仅迁移兜底：后端超管表未就绪或接口失败时，避免初始超管入口消失。
  const BOOTSTRAP_SUPER_ADMIN_EMAILS = new Set([
    'haimingadmin@club.local',
    'collen@club.local'
  ]);

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
      can_events: false,
      can_mall: false,
      can_members: false
    };
  }

  function bootstrapSuperAccess(session) {
    const email = String(session?.user?.email || '').toLowerCase();
    if (!BOOTSTRAP_SUPER_ADMIN_EMAILS.has(email)) {
      return { isSuperAdmin: false, permissions: emptyPermissions() };
    }
    return {
      isSuperAdmin: true,
      permissions: {
        can_checkin: true,
        can_points: true,
        can_messages: true,
        can_invites: true,
        can_events: true,
        can_mall: true,
        can_members: true
      }
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
      || permissions.can_mall
      || permissions.can_members
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
        return bootstrapSuperAccess(session);
      }
      const access = {
        isSuperAdmin: Boolean(payload.isSuperAdmin),
        permissions: {
          ...emptyPermissions(),
          ...(payload.permissions || {})
        }
      };
      // 后端尚未识别超管时，初始超管仍临时可见入口，便于继续完成 SQL / Function 部署。
      if (!hasStaffAccess(access)) {
        const fallback = bootstrapSuperAccess(session);
        if (fallback.isSuperAdmin) return fallback;
      }
      return access;
    } catch (_error) {
      return bootstrapSuperAccess(session);
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
