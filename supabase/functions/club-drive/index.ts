const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-drive-action, x-drive-path, x-drive-content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type, Content-Disposition, X-Drive-Bytes'
};

const MAX_FILE_BYTES = 100 * 1024 * 1024;
// 仅迁移兜底：club_super_admins 表为空时，临时放行初始超管邮箱。
const BOOTSTRAP_SUPER_ADMIN_EMAILS = new Set([
  'haimingadmin@club.local',
  'collen@club.local'
]);
const PERMISSION_KEYS = ['checkin', 'points', 'messages', 'invites', 'events', 'mall', 'members', 'join'] as const;
type PermissionKey = typeof PERMISSION_KEYS[number];
const encoder = new TextEncoder();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' }
});

function basicAuth(username: string, password: string) {
  const bytes = encoder.encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return `Basic ${btoa(binary)}`;
}

function userRoot(userId: string) {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `/user_${safeId}/`;
}

function decodeXml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function relativePath(input: unknown) {
  if (typeof input !== 'string') return [];
  const raw = input.replaceAll('\\', '/');
  if (raw.includes('\0')) throw new Error('非法文件路径。');
  return raw.split('/').filter(Boolean).map(part => {
    const decoded = decodeURIComponent(part);
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) throw new Error('非法文件路径。');
    return decoded;
  });
}

function pathFor(root: string, input: unknown, directory = false) {
  const parts = relativePath(input);
  return root + parts.map(encodeURIComponent).join('/') + (parts.length || directory ? '/' : '');
}

function filePathFor(root: string, input: unknown) {
  const parts = relativePath(input);
  if (!parts.length) throw new Error('必须指定文件路径。');
  return root + parts.map(encodeURIComponent).join('/');
}

function parseXmlFiles(xml: string) {
  const files: Array<{ name: string; type: string; size: string; bytes?: number; path: string }> = [];
  for (const match of xml.matchAll(/<d:response\b[\s\S]*?<d:href>([\s\S]*?)<\/d:href>[\s\S]*?<d:resourcetype>([\s\S]*?)<\/d:resourcetype>[\s\S]*?(?:<d:getcontentlength>([\s\S]*?)<\/d:getcontentlength>)?[\s\S]*?<\/d:response>/gi)) {
    const name = decodeURIComponent(decodeXml(match[1])).split('/').filter(Boolean).pop() || '';
    if (!name) continue;
    const isDirectory = match[2].includes('collection');
    const bytes = !isDirectory && match[3] ? Number(match[3]) : undefined;
    files.push({ name, type: isDirectory ? '文件夹' : '文件', size: bytes === undefined ? '-' : `${Math.ceil(bytes / 1024)} KB`, ...(bytes === undefined ? {} : { bytes }), path: name });
  }
  return files.slice(1);
}

async function webdavRequest(method: string, path: string, init: RequestInit = {}) {
  const baseUrl = Deno.env.get('WEBDAV_BASE_URL');
  const username = Deno.env.get('WEBDAV_USERNAME');
  const password = Deno.env.get('WEBDAV_PASSWORD');
  if (!baseUrl || !username || !password) throw new Error('WebDAV 服务端配置不完整。');
  return fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { ...init, method, headers: { authorization: basicAuth(username, password), ...(init.headers || {}) } });
}

function supabaseConfig() {
  const url = Deno.env.get('SUPABASE_URL');
  // Supabase 不允许用户自定义 Secret 使用 SUPABASE_ 前缀。
  // 因此服务端密钥使用自定义名称 CLUB_SERVICE_ROLE_KEY。
  const serviceKey = Deno.env.get('CLUB_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Supabase 服务端密钥未配置。');
  return { url, serviceKey };
}

async function getUser(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!token || !supabaseUrl) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || '', authorization: `Bearer ${token}` } });
  return response.ok ? await response.json() : null;
}

function headerPath(request: Request) {
  const value = request.headers.get('x-drive-path');
  if (!value) throw new Error('必须指定文件路径。');
  try { return decodeURIComponent(value); } catch { throw new Error('文件路径编码不合法。'); }
}

function contentLength(request: Request) {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function emptyPermissions() {
  return {
    can_checkin: false,
    can_points: false,
    can_messages: false,
    can_invites: false,
    can_events: false,
    can_mall: false,
    can_members: false,
    can_join: false
  };
}

function permissionColumn(permission: PermissionKey) {
  return (`can_${permission}`) as 'can_checkin' | 'can_points' | 'can_messages' | 'can_invites' | 'can_events' | 'can_mall' | 'can_members' | 'can_join';
}

async function getStaffPermissionRow(userId: string) {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_staff_permissions?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error('读取账号权限失败。');
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function listSuperAdmins() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_super_admins?select=*&order=created_at.asc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail.includes('Could not find the table') || detail.includes('relation')
      ? '超管表尚未创建，请先执行 club-super-admins-schema.sql。'
      : '读取超管名单失败。');
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchSuperAdminByQuery(query: string) {
  const { url, serviceKey } = supabaseConfig();
  try {
    const response = await fetch(
      `${url}/rest/v1/club_super_admins?${query}&select=*&limit=1`,
      { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
    );
    // 表未创建或查询失败时返回 null，交给 isSuperAdmin 做迁移兜底，避免入口整体消失。
    if (!response.ok) return null;
    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (_error) {
    return null;
  }
}

async function getSuperAdminRow(user: { id?: string; email?: string } | null) {
  if (!user?.id && !user?.email) return null;
  // 注意：PostgREST 的 or=() 内必须用 column.eq.value，不能写 column=eq.value。
  // 这里改成两次独立精确查询，避免 or 语法踩坑导致永远查不到超管。
  if (user.id) {
    const byId = await fetchSuperAdminByQuery(`user_id=eq.${encodeURIComponent(user.id)}`);
    if (byId) return byId;
  }
  if (typeof user.email === 'string' && user.email) {
    const byEmail = await fetchSuperAdminByQuery(`email=eq.${encodeURIComponent(user.email.toLowerCase())}`);
    if (byEmail) return byEmail;
  }
  return null;
}

function isBootstrapSuperAdminEmail(email: string) {
  return Boolean(email) && BOOTSTRAP_SUPER_ADMIN_EMAILS.has(email);
}

async function isSuperAdmin(user: { id?: string; email?: string } | null) {
  if (!user?.id && !user?.email) return false;
  const email = typeof user?.email === 'string' ? user.email.toLowerCase() : '';
  try {
    const row = await getSuperAdminRow(user);
    if (row) return true;
    // 迁移窗口兜底：
    // 1) 超管表为空时，临时放行初始超管邮箱
    // 2) 超管表尚未创建/读失败时，同样临时放行初始超管邮箱，避免管理员入口消失
    if (!isBootstrapSuperAdminEmail(email)) return false;
    try {
      const admins = await listSuperAdmins();
      if (admins.length === 0) return true;
      // 表已有数据但当前初始超管查不到时，再按邮箱兜底一次，兼容种子异常。
      return admins.some((item) => String(item?.email || '').toLowerCase() === email);
    } catch (_error) {
      return true;
    }
  } catch (_error) {
    return isBootstrapSuperAdminEmail(email);
  }
}

async function getUserAccess(user: { id?: string; email?: string } | null) {
  if (await isSuperAdmin(user)) {
    return {
      isSuperAdmin: true,
      permissions: {
        can_checkin: true,
        can_points: true,
        can_messages: true,
        can_invites: true,
        can_events: true,
        can_mall: true,
        can_members: true,
        can_join: true
      }
    };
  }
  if (!user?.id) return { isSuperAdmin: false, permissions: emptyPermissions() };
  const row = await getStaffPermissionRow(user.id);
  return {
    isSuperAdmin: false,
    permissions: {
      can_checkin: Boolean(row?.can_checkin),
      can_points: Boolean(row?.can_points),
      can_messages: Boolean(row?.can_messages),
      can_invites: Boolean(row?.can_invites),
      can_events: Boolean(row?.can_events),
      can_mall: Boolean(row?.can_mall),
      can_members: Boolean(row?.can_members),
      can_join: Boolean(row?.can_join)
    }
  };
}

async function requirePermission(user: { id?: string; email?: string } | null, permission: PermissionKey) {
  const access = await getUserAccess(user);
  if (access.isSuperAdmin || access.permissions[permissionColumn(permission)]) return access;
  throw new Error('无对应管理权限。');
}

async function requireSuperAdmin(user: { id?: string; email?: string } | null) {
  if (!(await isSuperAdmin(user))) throw new Error('仅超管可执行该操作。');
}

async function promoteSuperAdmin(
  adminUser: { id?: string; email?: string } | null,
  usernameInput: unknown,
  noteInput: unknown
) {
  await requireSuperAdmin(adminUser);
  const username = normalizeUsername(usernameInput);
  const target = await findAuthUserByUsername(username);
  const email = String(target.email || `${username}@club.local`).toLowerCase();
  if (await isSuperAdmin({ id: target.id, email })) {
    throw new Error('该账号已经是超管。');
  }
  const body = {
    user_id: target.id,
    username,
    email,
    note: asOptionalText(noteInput, 200) || '超管升级',
    granted_by: adminUser?.id || null,
    updated_at: new Date().toISOString()
  };
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_super_admins?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(body)
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload) || !payload[0]) {
    throw new Error((payload as { message?: string } | null)?.message || '升级超管失败。');
  }
  // 升为超管后，清理其 staff 权限行，避免状态混淆。
  await fetch(
    `${url}/rest/v1/club_staff_permissions?user_id=eq.${encodeURIComponent(target.id)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        prefer: 'return=minimal'
      }
    }
  );
  return payload[0];
}

async function revokeSuperAdmin(
  adminUser: { id?: string; email?: string } | null,
  usernameInput: unknown
) {
  await requireSuperAdmin(adminUser);
  const username = normalizeUsername(usernameInput);
  const target = await findAuthUserByUsername(username);
  if (adminUser?.id && target.id === adminUser.id) {
    throw new Error('不能撤销自己的超管权限。');
  }
  if (!(await isSuperAdmin({ id: target.id, email: target.email || `${username}@club.local` }))) {
    throw new Error('该账号不是超管。');
  }
  const admins = await listSuperAdmins();
  if (admins.length <= 1) {
    throw new Error('至少需要保留 1 名超管。');
  }
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_super_admins?user_id=eq.${encodeURIComponent(target.id)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        prefer: 'return=representation'
      }
    }
  );
  const payload = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(payload) || !payload.length) {
    throw new Error('撤销超管失败。');
  }
  return { ok: true, username };
}

function newInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let code = '';
  for (let index = 0; index < bytes.length; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
    if (index === 3 || index === 7) code += '-';
  }
  return code;
}

function rpcText(value: unknown): string | null {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value) && value.length === 1) return rpcText(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['result', 'consume_club_invite', 'commit_club_invite', 'release_club_invite', 'status']) {
      if (key in record) return rpcText(record[key]);
    }
  }
  return null;
}

async function rpcRequest(url: string, serviceKey: string, name: string, body: Record<string, unknown>) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function reserveInvite(url: string, serviceKey: string, inviteCode: string) {
  const { response, payload } = await rpcRequest(
    url,
    serviceKey,
    'reserve_club_invite',
    { invite_code: inviteCode.trim().toUpperCase() }
  );

  if (!response.ok) throw new Error('邀请码校验失败，请稍后重试。');

  const status = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? String((payload as Record<string, unknown>).status || '').toLowerCase()
    : rpcText(payload);

  if (status === 'invalid') throw new Error('无效邀请码。');
  if (status === 'used') throw new Error('邀请码已失效。');
  if (status === 'reserved') throw new Error('邀请码正在被其他注册请求使用，请稍后重试。');

  const token = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).token
    : null;
  if (status !== 'reserved_ok' || typeof token !== 'string' || !token) {
    throw new Error('邀请码校验失败，请稍后重试。');
  }
  return token;
}

async function releaseInvite(url: string, serviceKey: string, token: string) {
  await rpcRequest(url, serviceKey, 'release_club_invite', {
    reservation_token_value: token
  });
}

async function assertUsernameAvailable(url: string, serviceKey: string, username: string) {
  const email = `${username.toLowerCase()}@club.local`;
  const response = await fetch(
    `${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`
      }
    }
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok) throw new Error('用户名校验失败，请稍后重试。');

  const users = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.users)
      ? payload.users
      : [];
  if (users.some((user: unknown) => {
    const emailValue = user && typeof user === 'object'
      ? (user as Record<string, unknown>).email
      : null;
    return typeof emailValue === 'string' && emailValue.toLowerCase() === email;
  })) {
    throw new Error('用户名已存在。');
  }
}

async function deleteAuthUser(url: string, serviceKey: string, userId: string) {
  const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      payload.message ||
      payload.msg ||
      `临时账号清理失败（${response.status}）。`
    );
  }
}

async function createMember(username: unknown, password: unknown, inviteCode: unknown) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,64}$/.test(username.trim())) throw new Error('用户名只能使用 3 到 64 位字母、数字或下划线。');
  if (typeof password !== 'string' || password.length < 6) throw new Error('密码至少需要 6 位。');
  if (typeof inviteCode !== 'string' || !inviteCode.trim()) throw new Error('请输入邀请码。');

  const { url, serviceKey } = supabaseConfig();
  const normalizedUsername = username.trim().toLowerCase();
  // 重复用户名必须在预占邀请码之前停止，不能消耗邀请码。
  await assertUsernameAvailable(url, serviceKey, normalizedUsername);
  // 只有数据库原子预占成功后，才允许调用 Auth 创建用户。
  const reservationToken = await reserveInvite(url, serviceKey, inviteCode);
  let userId: string | null = null;

  try {
    const userResponse = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${normalizedUsername}@club.local`, password, email_confirm: true, user_metadata: { username: normalizedUsername } })
    });
    const userPayload = await userResponse.json().catch(() => ({}));
    // GoTrue Admin API 直接返回 User；部分客户端封装才返回 { user: User }。
    const createdUser = userPayload?.user || userPayload;
    if (!userResponse.ok || typeof createdUser?.id !== 'string') {
      throw new Error(
        userPayload.message ||
        userPayload.msg ||
        userPayload.error_description ||
        userPayload.error ||
        '账号创建失败，用户名可能已存在。'
      );
    }

    userId = createdUser.id;
    const { response, payload } = await rpcRequest(
      url,
      serviceKey,
      'commit_club_invite',
      { reservation_token_value: reservationToken, member_id: userId }
    );
    if (!response.ok || rpcText(payload) !== 'ok') {
      throw new Error('邀请码确认失败，请稍后重试。');
    }

    return { ok: true };
  } catch (error) {
    if (userId) {
      try {
        await deleteAuthUser(url, serviceKey, userId);
      } catch (cleanupError) {
        throw new Error(
          `${cleanupError instanceof Error ? cleanupError.message : '临时账号清理失败。'} 请管理员在 Authentication → Users 中删除账号 ${userId}。`
        );
      }
    }
    await releaseInvite(url, serviceKey, reservationToken);
    throw error;
  }
}

async function createInvites(count: unknown) {
  const total = Number(count);
  if (!Number.isInteger(total) || total < 1 || total > 100) throw new Error('每次可生成 1 到 100 个邀请码。');
  const { url, serviceKey } = supabaseConfig();
  const codes: string[] = [];
  while (codes.length < total) {
    const code = newInviteCode();
    const response = await fetch(`${url}/rest/v1/club_invite_codes`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ code })
    });
    if (response.ok) codes.push(code);
    else if (response.status !== 409) throw new Error('生成邀请码失败。');
  }
  return codes;
}

async function listInvites() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_invite_codes?select=code,created_at,used_at,used_by&order=created_at.desc`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } });
  if (!response.ok) throw new Error('读取邀请码列表失败。');
  return await response.json();
}

function pointFields(memberName: unknown, memberClass: unknown, points: unknown) {
  if (typeof memberName !== 'string' || !memberName.trim() || memberName.trim().length > 40) throw new Error('社员名需要为 1 到 40 个字符。');
  if (typeof memberClass !== 'string' || !memberClass.trim() || memberClass.trim().length > 40) throw new Error('社员班级需要为 1 到 40 个字符。');
  const numericPoints = Number(points);
  if (!Number.isInteger(numericPoints) || numericPoints < 0 || numericPoints > 1000000) throw new Error('社员积分必须是 0 到 1000000 的整数。');
  return {
    member_name: memberName.trim(),
    member_class: memberClass.trim(),
    points: numericPoints
  };
}

async function listMemberPoints() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_member_points?select=id,member_name,member_class,points,updated_at&order=points.desc,member_name.asc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error('读取积分公示失败。');
  return await response.json();
}

async function saveMemberPoints(id: unknown, memberName: unknown, memberClass: unknown, points: unknown) {
  const { url, serviceKey } = supabaseConfig();
  const fields = pointFields(memberName, memberClass, points);
  const isUpdate = typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
  const response = await fetch(
    isUpdate
      ? `${url}/rest/v1/club_member_points?id=eq.${encodeURIComponent(id)}`
      : `${url}/rest/v1/club_member_points`,
    {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(fields)
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 409) throw new Error('该社员名与班级组合已存在。');
    throw new Error('保存社员积分失败。');
  }
  if (isUpdate && (!Array.isArray(payload) || payload.length !== 1)) throw new Error('未找到需要修改的社员。');
  return Array.isArray(payload) ? payload[0] : payload;
}

async function deleteMemberPoints(id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('社员记录标识不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_member_points?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('删除社员积分失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到需要删除的社员。');
}

function messageFields(memberName: unknown, memberClass: unknown, messageContent: unknown) {
  if (typeof memberName !== 'string' || !memberName.trim() || memberName.trim().length > 40) throw new Error('姓名需要为 1 到 40 个字符。');
  if (typeof memberClass !== 'string' || !memberClass.trim() || memberClass.trim().length > 40) throw new Error('班级需要为 1 到 40 个字符。');
  if (typeof messageContent !== 'string' || !messageContent.trim() || messageContent.trim().length > 1000) throw new Error('留言内容需要为 1 到 1000 个字符。');
  return {
    member_name: memberName.trim(),
    member_class: memberClass.trim(),
    message_content: messageContent.trim()
  };
}

async function listMemberMessages() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_member_messages?select=id,member_name,member_class,message_content,created_at,updated_at&order=created_at.desc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error('读取留言箱失败。');
  return await response.json();
}

async function createMemberMessage(memberName: unknown, memberClass: unknown, messageContent: unknown) {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_member_messages`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(messageFields(memberName, memberClass, messageContent))
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('提交留言失败。');
  return Array.isArray(payload) ? payload[0] : payload;
}

async function updateMemberMessage(id: unknown, memberName: unknown, memberClass: unknown, messageContent: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('留言记录标识不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_member_messages?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(messageFields(memberName, memberClass, messageContent))
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('修改留言失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到需要修改的留言。');
  return payload[0];
}

async function deleteMemberMessage(id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('留言记录标识不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_member_messages?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('删除留言失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到需要删除的留言。');
}

function newCheckinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
}

function checkinFields(points: unknown, usageMode: unknown, expiresAt: unknown) {
  const numericPoints = Number(points);
  if (!Number.isInteger(numericPoints) || numericPoints < 1 || numericPoints > 1000000) throw new Error('签到积分必须是 1 到 1000000 的整数。');
  if (usageMode !== 'global_once' && usageMode !== 'per_member_once') throw new Error('签到码用量模式不合法。');
  if (typeof expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(expiresAt)) throw new Error('请选择有效的签到码有效期。');

  // datetime-local 不携带时区；所有签到时间固定按北京时间（UTC+8）解释。
  const expiry = new Date(`${expiresAt}:00+08:00`);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('有效期必须晚于当前时间。');
  return { points: numericPoints, usage_mode: usageMode, expires_at: expiry.toISOString() };
}

async function createCheckinCode(user: any, points: unknown, usageMode: unknown, expiresAt: unknown) {
  const { url, serviceKey } = supabaseConfig();
  const fields = checkinFields(points, usageMode, expiresAt);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = newCheckinCode();
    const response = await fetch(`${url}/rest/v1/club_checkin_codes`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ ...fields, code, created_by: user.email.toLowerCase() })
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && Array.isArray(payload) && payload[0]) return payload[0];
    if (response.status !== 409) throw new Error('创建签到码失败。');
  }
  throw new Error('生成签到码失败，请重试。');
}

async function listCheckinCodes() {
  const { url, serviceKey } = supabaseConfig();
  const [codesResponse, usesResponse] = await Promise.all([
    fetch(`${url}/rest/v1/club_checkin_codes?select=id,code,points,usage_mode,expires_at,created_by,used_count,created_at&order=created_at.desc`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }),
    fetch(`${url}/rest/v1/club_checkin_uses?select=id,checkin_code_id,member_name,checked_in_email,points_awarded,used_at&order=used_at.desc`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } })
  ]);
  if (!codesResponse.ok || !usesResponse.ok) throw new Error('读取签到记录失败。');
  return { codes: await codesResponse.json(), uses: await usesResponse.json() };
}

async function listPendingCheckins() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_checkin_pending?select=id,member_name,submitted_email,created_at,club_checkin_codes(code,points)&order=created_at.desc`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } });
  if (!response.ok) throw new Error('读取待处理签到失败。');
  return await response.json();
}

async function resolvePendingCheckin(id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('待处理记录标识不合法。');
  }

  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_checkin_pending?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        Prefer: 'return=representation'
      }
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('删除待处理签到失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到待处理签到。');
}

async function redeemCheckin(user: any, code: unknown, memberName: unknown) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9]{6,20}$/.test(code.trim())) throw new Error('签到码格式不正确。');
  if (typeof memberName !== 'string' || !/^[一-龥]{2,20}$/.test(memberName.trim())) throw new Error('姓名必须为 2 到 20 个连续中文字符。');
  const { url, serviceKey } = supabaseConfig();
  const { response, payload } = await rpcRequest(url, serviceKey, 'redeem_club_checkin', {
    input_code: code.trim().toUpperCase(),
    input_name: memberName.trim(),
    input_user_id: user.id,
    input_email: user.email.toLowerCase()
  });
  if (!response.ok) throw new Error(payload?.message || payload?.hint || '签到失败，请稍后重试。');
  return payload;
}

function validUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function courseMemberName(value: unknown) {
  if (typeof value !== 'string' || !/^[一-龥]{2,20}$/.test(value.trim())) throw new Error('姓名必须为 2 到 20 个连续中文字符。');
  return value.trim();
}

async function submitCourseCheckin(user: any, memberName: unknown) {
  const name = courseMemberName(memberName);
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_course_checkin_requests`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      member_name: name,
      submitted_by: user.id,
      submitted_email: String(user.email || '').toLowerCase()
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || '课程签到提交失败。');
  return Array.isArray(payload) ? payload[0] : payload;
}

async function listCourseCheckins() {
  const { url, serviceKey } = supabaseConfig();
  const [requestsResponse, membersResponse] = await Promise.all([
    fetch(`${url}/rest/v1/club_course_checkin_requests?select=id,member_name,submitted_email,created_at&order=created_at.asc`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }),
    fetch(`${url}/rest/v1/club_member_points?select=member_name`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } })
  ]);
  if (!requestsResponse.ok || !membersResponse.ok) throw new Error('读取课程签到申请失败。');
  const requests = await requestsResponse.json();
  const members = await membersResponse.json();
  const counts = new Map<string, number>();
  for (const member of Array.isArray(members) ? members : []) counts.set(member.member_name, (counts.get(member.member_name) || 0) + 1);
  return (Array.isArray(requests) ? requests : []).map(item => ({ ...item, matching_count: counts.get(item.member_name) || 0 }));
}

async function listCourseAttendance(dateValue: unknown) {
  const date = typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : new Date().toISOString().slice(0, 10);
  const start = `${date}T00:00:00+08:00`;
  const end = `${date}T00:00:00+08:00`;
  const { url, serviceKey } = supabaseConfig();
  const query = `?select=id,member_name,member_class,checked_in_at&checked_in_at=gte.${encodeURIComponent(start)}&checked_in_at=lt.${encodeURIComponent(new Date(new Date(end).getTime() + 86400000).toISOString())}&order=checked_in_at.asc`;
  const response = await fetch(`${url}/rest/v1/club_course_checkin_attendance${query}`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } });
  if (!response.ok) throw new Error('读取课程签到日记录失败。');
  const attendance = await response.json();
  return { date, count: Array.isArray(attendance) ? attendance.length : 0, attendance: Array.isArray(attendance) ? attendance : [] };
}

async function approveCourseCheckin(id: unknown) {
  if (!validUuid(id)) throw new Error('课程签到记录标识不合法。');
  const { url, serviceKey } = supabaseConfig();
  const { response, payload } = await rpcRequest(url, serviceKey, 'approve_club_course_checkin', { input_request_id: id });
  if (!response.ok) throw new Error(payload?.message || payload?.hint || '确认课程签到失败。');
  return payload;
}

async function rejectCourseCheckin(id: unknown) {
  if (!validUuid(id)) throw new Error('课程签到记录标识不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_course_checkin_requests?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, Prefer: 'return=representation' }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('拒绝课程签到失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到课程签到记录。');
}

async function addCourseCheckinMember(id: unknown, memberClass: unknown) {
  if (!validUuid(id)) throw new Error('课程签到记录标识不合法。');
  if (typeof memberClass !== 'string' || !memberClass.trim() || memberClass.trim().length > 40) throw new Error('班级需要为 1 到 40 个字符。');
  const { url, serviceKey } = supabaseConfig();
  const { response, payload } = await rpcRequest(url, serviceKey, 'add_club_course_checkin_member', { input_request_id: id, input_class: memberClass.trim() });
  if (!response.ok) throw new Error(payload?.message || payload?.hint || '添加积分榜成员失败。');
  return payload;
}

async function getMemberProfile(user: { id?: string }) {
  if (!user?.id) throw new Error('您还不是算法社社员！');
  const { url, serviceKey } = supabaseConfig();
  const { response, payload } = await rpcRequest(url, serviceKey, 'get_club_member_profile', {
    p_user_id: user.id
  });
  if (!response.ok) {
    throw new Error((payload as { message?: string; error?: string } | null)?.message
      || (payload as { message?: string; error?: string } | null)?.error
      || '读取社员资料失败。');
  }
  return payload;
}

async function bindMemberProfile(
  user: { id?: string; email?: string },
  memberName: unknown,
  memberClass: unknown
) {
  if (!user?.id) throw new Error('您还不是算法社社员！');
  const { url, serviceKey } = supabaseConfig();
  const { response, payload } = await rpcRequest(url, serviceKey, 'bind_club_member_profile', {
    p_user_id: user.id,
    p_email: user.email || '',
    p_member_name: memberName,
    p_member_class: memberClass
  });
  if (!response.ok) {
    throw new Error((payload as { message?: string; error?: string } | null)?.message
      || (payload as { message?: string; error?: string } | null)?.error
      || '绑定社员资料失败。');
  }
  return payload;
}

function normalizeThemeMode(value: unknown) {
  const mode = String(value ?? '').trim().toLowerCase();
  return mode === 'light' || mode === 'dark' || mode === 'auto' ? mode : 'auto';
}

function isMissingRpcError(payload: unknown, response?: Response) {
  const text = JSON.stringify(payload || {});
  const status = response?.status || 0;
  return status === 404
    || /Could not find the function|PGRST202|42883|does not exist|schema cache/i.test(text);
}

async function getMemberThemePreference(user: { id?: string }) {
  if (!user?.id) throw new Error('您还不是算法社社员！');
  const { url, serviceKey } = supabaseConfig();
  const { response, payload } = await rpcRequest(url, serviceKey, 'get_club_ui_preferences', {
    p_user_id: user.id
  });
  if (!response.ok) {
    if (isMissingRpcError(payload, response)) {
      return { theme_mode: 'auto', exists: false };
    }
    throw new Error((payload as { message?: string; error?: string } | null)?.message
      || (payload as { message?: string; error?: string } | null)?.error
      || '读取主题偏好失败。');
  }
  const row = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  return {
    theme_mode: normalizeThemeMode(row.theme_mode ?? row.themeMode),
    exists: Boolean(row.exists),
    updated_at: row.updated_at ?? null
  };
}

async function setMemberThemePreference(user: { id?: string }, themeMode: unknown) {
  if (!user?.id) throw new Error('您还不是算法社社员！');
  const mode = normalizeThemeMode(themeMode);
  const { url, serviceKey } = supabaseConfig();
  const { response, payload } = await rpcRequest(url, serviceKey, 'set_club_ui_theme_mode', {
    p_user_id: user.id,
    p_theme_mode: mode
  });
  if (!response.ok) {
    throw new Error((payload as { message?: string; error?: string } | null)?.message
      || (payload as { message?: string; error?: string } | null)?.error
      || '保存主题偏好失败。');
  }
  const row = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  return {
    theme_mode: normalizeThemeMode(row.theme_mode ?? mode),
    exists: true,
    updated_at: row.updated_at ?? null
  };
}


function asNonEmptyText(value: unknown, label: string, max = 200) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空。`);
  const textValue = value.trim();
  if (textValue.length > max) throw new Error(`${label}过长。`);
  return textValue;
}

function asOptionalText(value: unknown, max = 2000) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new Error('文本字段格式不正确。');
  const textValue = value.trim();
  if (textValue.length > max) throw new Error('文本字段过长。');
  return textValue;
}

function asOptionalTime(value: unknown) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('时间格式不正确。');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('时间格式不正确。');
  return date.toISOString();
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

async function listStaffPermissions() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_staff_permissions?select=*&order=updated_at.desc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error('读取权限列表失败。');
  return await response.json();
}

async function listAppMonitorReleases() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/appmonitor_releases?select=*&order=release_date.desc,created_at.desc`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } });
  if (!response.ok) throw new Error('读取 APPMonitor 版本失败。');
  return await response.json();
}

async function saveAppMonitorRelease(user: { id?: string }, payload: Record<string, unknown>) {
  const version = asNonEmptyText(payload.version, '版本号', 40);
  const versionMatch = /^v(\d+)(?:\.(\d+))?$/i.exec(version);
  if (!versionMatch || Number(versionMatch[1]) < 7 || (Number(versionMatch[1]) === 7 && Number(versionMatch[2] || 0) < 5)) {
    throw new Error('这里只能管理 V7.5 及之后的版本。');
  }
  const releaseDate = asOptionalText(payload.release_date ?? payload.releaseDate, 20) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new Error('发布日期格式不正确。');
  const downloadUrl = asNonEmptyText(payload.download_url ?? payload.downloadUrl, '下载链接', 1000);
  if (!/^https?:\/\//i.test(downloadUrl)) throw new Error('下载链接必须是 http 或 https 地址。');
  const body = { version, release_date: releaseDate, intro_zh: asOptionalText(payload.intro_zh ?? payload.introZh, 5000), intro_en: asOptionalText(payload.intro_en ?? payload.introEn, 5000), download_url: downloadUrl, updated_by: user?.id || null, updated_at: new Date().toISOString() };
  const { url, serviceKey } = supabaseConfig();
  const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : '';
  const response = await fetch(id ? `${url}/rest/v1/appmonitor_releases?id=eq.${encodeURIComponent(id)}` : `${url}/rest/v1/appmonitor_releases`, { method: id ? 'PATCH' : 'POST', headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(id ? body : { ...body, created_at: new Date().toISOString() }) });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows) || !rows[0]) throw new Error('保存 APPMonitor 版本失败。');
  return rows[0];
}

async function deleteAppMonitorRelease(idInput: unknown) {
  if (typeof idInput !== 'string' || !idInput.trim()) throw new Error('缺少版本编号。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/appmonitor_releases?id=eq.${encodeURIComponent(idInput.trim())}`, { method: 'DELETE', headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, prefer: 'return=minimal' } });
  if (!response.ok) throw new Error('删除 APPMonitor 版本失败。');
  return { ok: true };
}

async function upsertStaffPermissions(
  adminUser: { id?: string },
  usernameInput: unknown,
  flags: Record<string, unknown>,
  noteInput: unknown
) {
  const username = normalizeUsername(usernameInput);
  const user = await findAuthUserByUsername(username);
  if (await isSuperAdmin({ id: user.id, email: user.email || `${username}@club.local` })) {
    throw new Error('不能修改超管账号权限。');
  }
  const body = {
    user_id: user.id,
    username,
    email: user.email || `${username}@club.local`,
    can_checkin: asBoolean(flags.can_checkin),
    can_points: asBoolean(flags.can_points),
    can_messages: asBoolean(flags.can_messages),
    can_invites: asBoolean(flags.can_invites),
    can_events: asBoolean(flags.can_events),
    can_mall: asBoolean(flags.can_mall),
    can_members: asBoolean(flags.can_members),
    can_join: asBoolean(flags.can_join),
    note: asOptionalText(noteInput, 200),
    updated_by: adminUser?.id || null,
    updated_at: new Date().toISOString()
  };
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_staff_permissions?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(body)
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload) || !payload[0]) {
    throw new Error((payload as { message?: string } | null)?.message || '保存权限失败。');
  }
  return payload[0];
}

async function deleteStaffPermissions(usernameInput: unknown) {
  const username = normalizeUsername(usernameInput);
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_staff_permissions?username=eq.${encodeURIComponent(username)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        prefer: 'return=representation'
      }
    }
  );
  const payload = await response.json().catch(() => []);
  if (!response.ok) throw new Error('删除权限失败。');
  if (!Array.isArray(payload) || !payload.length) throw new Error('未找到该账号的权限记录。');
  return { ok: true };
}

async function listAnnouncements(adminView = false) {
  const { url, serviceKey } = supabaseConfig();
  const filter = adminView ? '' : '&is_published=eq.true';
  const response = await fetch(
    `${url}/rest/v1/club_announcements?select=*&order=is_pinned.desc,updated_at.desc${filter}`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error('读取公告失败。');
  return await response.json();
}

async function saveAnnouncement(user: { id?: string }, payload: Record<string, unknown>) {
  const nowIso = new Date().toISOString();
  const isFeatured = asBoolean(payload.is_featured);
  const body: Record<string, unknown> = {
    title: asNonEmptyText(payload.title, '公告标题', 120),
    content: asNonEmptyText(payload.content, '公告内容', 5000),
    category: asNonEmptyText(payload.category || '社团通知', '公告分类', 40),
    is_pinned: asBoolean(payload.is_pinned),
    is_featured: isFeatured,
    is_published: asBoolean(payload.is_published, true),
    starts_at: asOptionalTime(payload.starts_at),
    ends_at: asOptionalTime(payload.ends_at),
    updated_by: user?.id || null,
    updated_at: nowIso
  };
  const { url, serviceKey } = supabaseConfig();
  if (typeof payload.id === 'string' && payload.id.trim()) {
    if (isFeatured) {
      const currentResponse = await fetch(
        `${url}/rest/v1/club_announcements?id=eq.${encodeURIComponent(payload.id.trim())}&select=is_featured,featured_push_at&limit=1`,
        { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
      );
      const currentRows = await currentResponse.json().catch(() => []);
      const current = Array.isArray(currentRows) ? currentRows[0] : null;
      if (!current?.is_featured || !current?.featured_push_at) {
        body.featured_push_at = nowIso;
      }
    }
    const response = await fetch(
      `${url}/rest/v1/club_announcements?id=eq.${encodeURIComponent(payload.id.trim())}`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          'content-type': 'application/json',
          prefer: 'return=representation'
        },
        body: JSON.stringify(body)
      }
    );
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows) || !rows[0]) throw new Error('更新公告失败。');
    return rows[0];
  }
  if (isFeatured) body.featured_push_at = nowIso;
  const response = await fetch(`${url}/rest/v1/club_announcements`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: JSON.stringify({ ...body, created_by: user?.id || null })
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows) || !rows[0]) throw new Error('发布公告失败。');
  return rows[0];
}

async function deleteAnnouncement(idInput: unknown) {
  if (typeof idInput !== 'string' || !idInput.trim()) throw new Error('缺少公告编号。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_announcements?id=eq.${encodeURIComponent(idInput.trim())}`,
    {
      method: 'DELETE',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, prefer: 'return=minimal' }
    }
  );
  if (!response.ok) throw new Error('删除公告失败。');
  return { ok: true };
}

async function listEvents(adminView = false) {
  const { url, serviceKey } = supabaseConfig();
  const filter = adminView ? '' : '&is_published=eq.true';
  const response = await fetch(
    `${url}/rest/v1/club_events?select=*&order=is_featured.desc,starts_at.nullslast,updated_at.desc${filter}`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error('读取活动失败。');
  return await response.json();
}

async function saveEvent(user: { id?: string }, payload: Record<string, unknown>) {
  const limitRaw = payload.signup_limit;
  let signupLimit: number | null = null;
  if (limitRaw != null && limitRaw !== '') {
    const value = Number(limitRaw);
    if (!Number.isInteger(value) || value <= 0) throw new Error('报名人数上限必须是正整数。');
    signupLimit = value;
  }
  const nowIso = new Date().toISOString();
  const isFeatured = asBoolean(payload.is_featured);
  const body: Record<string, unknown> = {
    title: asNonEmptyText(payload.title, '活动标题', 120),
    summary: asOptionalText(payload.summary, 500),
    content: asOptionalText(payload.content, 8000),
    category: asNonEmptyText(payload.category || '活动报名', '活动分类', 40),
    status: asNonEmptyText(payload.status || '报名中', '活动状态', 20),
    location: asOptionalText(payload.location, 120),
    starts_at: asOptionalTime(payload.starts_at),
    ends_at: asOptionalTime(payload.ends_at),
    signup_deadline: asOptionalTime(payload.signup_deadline),
    allow_signup: asBoolean(payload.allow_signup, true),
    signup_limit: signupLimit,
    is_featured: isFeatured,
    is_published: asBoolean(payload.is_published, true),
    updated_by: user?.id || null,
    updated_at: nowIso
  };
  const { url, serviceKey } = supabaseConfig();
  if (typeof payload.id === 'string' && payload.id.trim()) {
    if (isFeatured) {
      const currentResponse = await fetch(
        `${url}/rest/v1/club_events?id=eq.${encodeURIComponent(payload.id.trim())}&select=is_featured,featured_push_at&limit=1`,
        { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
      );
      const currentRows = await currentResponse.json().catch(() => []);
      const current = Array.isArray(currentRows) ? currentRows[0] : null;
      if (!current?.is_featured || !current?.featured_push_at) {
        body.featured_push_at = nowIso;
      }
    }
    const response = await fetch(
      `${url}/rest/v1/club_events?id=eq.${encodeURIComponent(payload.id.trim())}`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          'content-type': 'application/json',
          prefer: 'return=representation'
        },
        body: JSON.stringify(body)
      }
    );
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows) || !rows[0]) throw new Error('更新活动失败。');
    return rows[0];
  }
  if (isFeatured) body.featured_push_at = nowIso;
  const response = await fetch(`${url}/rest/v1/club_events`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: JSON.stringify({ ...body, created_by: user?.id || null })
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows) || !rows[0]) throw new Error('创建活动失败。');
  return rows[0];
}

async function repushHomeFeatured(kindInput: unknown, idInput: unknown, user: { id?: string } | null) {
  const kind = typeof kindInput === 'string' ? kindInput.trim() : '';
  if (kind !== 'announcement' && kind !== 'event') throw new Error('推送类型无效。');
  if (typeof idInput !== 'string' || !idInput.trim()) throw new Error(kind === 'announcement' ? '缺少公告编号。' : '缺少活动编号。');
  const table = kind === 'announcement' ? 'club_announcements' : 'club_events';
  const label = kind === 'announcement' ? '公告' : '活动';
  const nowIso = new Date().toISOString();
  const { url, serviceKey } = supabaseConfig();
  const currentResponse = await fetch(
    `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(idInput.trim())}&select=*&limit=1`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  const currentRows = await currentResponse.json().catch(() => []);
  const current = Array.isArray(currentRows) ? currentRows[0] : null;
  if (!current) throw new Error(`未找到该${label}。`);
  if (!current.is_published) throw new Error(`仅已发布的${label}可再次推送主页。`);

  const response = await fetch(
    `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(idInput.trim())}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=representation'
      },
      body: JSON.stringify({
        is_featured: true,
        featured_push_at: nowIso,
        updated_by: user?.id || null,
        updated_at: nowIso
      })
    }
  );
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows) || !rows[0]) {
    const detail = !Array.isArray(rows) && rows && typeof rows === 'object'
      ? String((rows as { message?: string; hint?: string; details?: string; error?: string }).message
        || (rows as { hint?: string }).hint
        || (rows as { details?: string }).details
        || (rows as { error?: string }).error
        || '').trim()
      : '';
    if (/featured_push_at/i.test(detail) || /column/i.test(detail)) {
      throw new Error(`再次推送${label}失败：数据库缺少 featured_push_at 字段，请先执行最新 schema SQL。`);
    }
    throw new Error(detail ? `再次推送${label}失败：${detail}` : `再次推送${label}失败。`);
  }
  return {
    item: rows[0],
    message: `已再次推送该${label}到主页。之前点过“不再提醒”的用户也会再看到一次。`
  };
}

async function deleteEvent(idInput: unknown) {
  if (typeof idInput !== 'string' || !idInput.trim()) throw new Error('缺少活动编号。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_events?id=eq.${encodeURIComponent(idInput.trim())}`,
    {
      method: 'DELETE',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, prefer: 'return=minimal' }
    }
  );
  if (!response.ok) throw new Error('删除活动失败。');
  return { ok: true };
}

async function listEventSignups(eventIdInput: unknown) {
  if (typeof eventIdInput !== 'string' || !eventIdInput.trim()) throw new Error('缺少活动编号。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_event_signups?event_id=eq.${encodeURIComponent(eventIdInput.trim())}&select=*&order=created_at.desc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error('读取报名名单失败。');
  return await response.json();
}

async function signupEvent(
  user: { id?: string; email?: string } | null,
  eventIdInput: unknown,
  memberNameInput: unknown,
  memberClassInput: unknown,
  contactInput: unknown,
  noteInput: unknown
) {
  if (typeof eventIdInput !== 'string' || !eventIdInput.trim()) throw new Error('缺少活动编号。');
  const eventId = eventIdInput.trim();
  const memberName = asNonEmptyText(memberNameInput, '姓名', 40);
  const memberClass = asOptionalText(memberClassInput, 40);
  const contact = asOptionalText(contactInput, 80);
  const note = asOptionalText(noteInput, 300);
  const username = typeof user?.email === 'string' && user.email.includes('@')
    ? user.email.split('@')[0]
    : '';
  const { url, serviceKey } = supabaseConfig();

  const eventResponse = await fetch(
    `${url}/rest/v1/club_events?id=eq.${encodeURIComponent(eventId)}&select=*&limit=1`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  const eventRows = await eventResponse.json().catch(() => []);
  const event = Array.isArray(eventRows) ? eventRows[0] : null;
  if (!event || !event.is_published) throw new Error('活动不存在或未发布。');
  if (!event.allow_signup) throw new Error('该活动未开放报名。');
  if (['已截止', '已结束', '已取消', '草稿'].includes(event.status)) {
    throw new Error(`当前活动状态为「${event.status}」，无法报名。`);
  }
  if (event.signup_deadline && new Date(event.signup_deadline).getTime() < Date.now()) {
    throw new Error('报名已截止。');
  }

  const countResponse = await fetch(
    `${url}/rest/v1/club_event_signups?event_id=eq.${encodeURIComponent(eventId)}&status=eq.${encodeURIComponent('已报名')}&select=id`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, prefer: 'count=exact' }, method: 'HEAD' }
  );
  const countHeader = countResponse.headers.get('content-range');
  const currentCount = countHeader && countHeader.includes('/')
    ? Number(countHeader.split('/')[1])
    : null;
  if (event.signup_limit && currentCount != null && currentCount >= event.signup_limit) {
    throw new Error('报名人数已满。');
  }

  const response = await fetch(`${url}/rest/v1/club_event_signups`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: JSON.stringify({
      event_id: eventId,
      user_id: user?.id || null,
      username,
      member_name: memberName,
      member_class: memberClass,
      contact,
      note,
      status: '已报名'
    })
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows) || !rows[0]) {
    const message = Array.isArray(rows) ? rows[0]?.message : rows?.message;
    if (typeof message === 'string' && message.toLowerCase().includes('duplicate')) {
      throw new Error('你已经报名过该活动。');
    }
    throw new Error(message || '报名失败。');
  }
  return rows[0];
}

async function updateEventSignupStatus(idInput: unknown, statusInput: unknown) {
  if (typeof idInput !== 'string' || !idInput.trim()) throw new Error('缺少报名编号。');
  const status = asNonEmptyText(statusInput, '报名状态', 20);
  if (!['已报名', '已取消', '已拒绝'].includes(status)) throw new Error('报名状态不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_event_signups?id=eq.${encodeURIComponent(idInput.trim())}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=representation'
      },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    }
  );
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows) || !rows[0]) throw new Error('更新报名状态失败。');
  return rows[0];
}

async function publicHomeFeed() {
  const [announcements, events] = await Promise.all([
    listAnnouncements(false),
    listEvents(false)
  ]);
  return {
    announcements: Array.isArray(announcements) ? announcements.slice(0, 6) : [],
    events: Array.isArray(events) ? events.slice(0, 8) : []
  };
}


async function listAuthUsersPage(url: string, serviceKey: string, page: number, perPage = 200) {
  const response = await fetch(
    `${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
    {
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`
      }
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload && typeof payload === 'object'
        ? (payload as { message?: string; msg?: string; error?: string }).message
          || (payload as { message?: string; msg?: string; error?: string }).msg
          || (payload as { message?: string; msg?: string; error?: string }).error
        : null)
      || '读取已注册账号失败。'
    );
  }
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray((payload as { users?: unknown[] }).users)) {
    return (payload as { users: unknown[] }).users;
  }
  return [];
}

async function listAllAuthUsers() {
  const { url, serviceKey } = supabaseConfig();
  const users: Array<Record<string, unknown>> = [];
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const rows = await listAuthUsersPage(url, serviceKey, page, perPage);
    for (const item of rows) {
      if (item && typeof item === 'object') users.push(item as Record<string, unknown>);
    }
    if (rows.length < perPage) break;
  }
  return users;
}

function usernameFromAuthUser(user: Record<string, unknown>) {
  const meta = user.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata as Record<string, unknown>
    : null;
  const metaUsername = typeof meta?.username === 'string' ? meta.username.trim() : '';
  if (metaUsername) return metaUsername.toLowerCase();
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (email.endsWith('@club.local')) return email.slice(0, -'@club.local'.length);
  if (email.includes('@')) return email.split('@')[0] || email;
  return typeof user.id === 'string' ? user.id : '';
}

async function listMemberProfiles() {
  const { url, serviceKey } = supabaseConfig();
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

  // 以 Auth 全量用户为准，再 left-join 绑定资料，避免 club_profiles 缺行导致账号漏列。
  const [authUsers, profilesResponse, accountsResponse] = await Promise.all([
    listAllAuthUsers(),
    fetch(
      `${url}/rest/v1/club_member_profiles?select=user_id,username,email,member_name,member_class,points_member_id,created_at,updated_at&order=updated_at.desc`,
      { headers }
    ),
    fetch(
      `${url}/rest/v1/club_profiles?select=id,username,created_at&order=created_at.desc`,
      { headers }
    )
  ]);

  if (!profilesResponse.ok) throw new Error('读取社员绑定资料失败。');
  const profileRowsRaw = await profilesResponse.json().catch(() => []);
  const profileRows = Array.isArray(profileRowsRaw) ? profileRowsRaw : [];
  const profileByUserId = new Map<string, Record<string, unknown>>();
  for (const item of profileRows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.user_id === 'string') profileByUserId.set(row.user_id, row);
  }

  const accountByUserId = new Map<string, Record<string, unknown>>();
  if (accountsResponse.ok) {
    const accountRowsRaw = await accountsResponse.json().catch(() => []);
    const accountRows = Array.isArray(accountRowsRaw) ? accountRowsRaw : [];
    for (const item of accountRows) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.id === 'string') accountByUserId.set(row.id, row);
    }
  }

  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];

  const pushMergedRow = (input: {
    userId: string;
    username: string;
    email: string;
    registeredAt: string | null;
    profile?: Record<string, unknown>;
  }) => {
    const profile = input.profile;
    const memberName = typeof profile?.member_name === 'string' ? profile.member_name.trim() : '';
    const memberClass = typeof profile?.member_class === 'string' ? profile.member_class.trim() : '';
    const bound = Boolean(memberName);
    merged.push({
      user_id: input.userId,
      username: input.username,
      email: input.email,
      bound,
      // 即使旧数据异常，也如实回传表内姓名/班级，避免前端误显示成全员未绑定。
      member_name: memberName || null,
      member_class: memberClass || null,
      points_member_id: bound ? (profile?.points_member_id ?? null) : null,
      created_at: profile?.created_at ?? null,
      updated_at: profile?.updated_at ?? null,
      registered_at: input.registeredAt
    });
  };

  for (const authUser of authUsers) {
    const userId = typeof authUser.id === 'string' ? authUser.id : '';
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);

    const account = accountByUserId.get(userId);
    const profile = profileByUserId.get(userId);
    const username = (
      (typeof account?.username === 'string' && account.username.trim())
      || (typeof profile?.username === 'string' && profile.username.trim())
      || usernameFromAuthUser(authUser)
      || userId
    ).toLowerCase();
    const email = (
      (typeof profile?.email === 'string' && profile.email.trim())
      || (typeof authUser.email === 'string' && authUser.email.trim())
      || `${username}@club.local`
    );
    const registeredAt = (
      (typeof account?.created_at === 'string' && account.created_at)
      || (typeof authUser.created_at === 'string' && authUser.created_at)
      || null
    );

    pushMergedRow({ userId, username, email, registeredAt, profile });
  }

  // 兜底：Auth 列表漏掉时，仍并入 club_profiles 中的已注册账号。
  for (const [userId, account] of accountByUserId.entries()) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    const profile = profileByUserId.get(userId);
    const username = (
      (typeof account.username === 'string' && account.username.trim())
      || (typeof profile?.username === 'string' && profile.username.trim())
      || userId
    ).toLowerCase();
    pushMergedRow({
      userId,
      username,
      email: (typeof profile?.email === 'string' && profile.email.trim()) || `${username}@club.local`,
      registeredAt: (typeof account.created_at === 'string' && account.created_at) || null,
      profile
    });
  }

  // 兜底：若前两处都漏掉某些已绑定用户，仍保证绑定资料可见。
  for (const [userId, profile] of profileByUserId.entries()) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    const username = (
      (typeof profile.username === 'string' && profile.username.trim())
      || userId
    ).toLowerCase();
    pushMergedRow({
      userId,
      username,
      email: typeof profile.email === 'string' ? profile.email : `${username}@club.local`,
      registeredAt: (typeof profile.created_at === 'string' && profile.created_at) || null,
      profile
    });
  }

  merged.sort((a, b) => {
    const aBound = Boolean(a.bound);
    const bBound = Boolean(b.bound);
    if (aBound !== bBound) return aBound ? 1 : -1;
    if (!aBound && !bBound) {
      return String(b.registered_at || '').localeCompare(String(a.registered_at || ''));
    }
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });

  return merged;
}

async function adminBindMemberProfile(
  usernameInput: unknown,
  memberName: unknown,
  memberClass: unknown
) {
  const username = normalizeUsername(usernameInput);
  const target = await findAuthUserByUsername(username);
  const result = await bindMemberProfile(
    {
      id: target.id,
      email: target.email || `${username}@club.local`
    },
    memberName,
    memberClass
  );
  return {
    ...(result && typeof result === 'object' ? result as Record<string, unknown> : { bound: true }),
    message: `已更新账号 ${username} 的姓名与班级绑定。`
  };
}

function normalizeUsername(username: unknown) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,64}$/.test(username.trim())) {
    throw new Error('用户名只能使用 3 到 64 位字母、数字或下划线。');
  }
  return username.trim().toLowerCase();
}

function normalizePassword(password: unknown) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('密码至少需要 6 位。');
  }
  return password;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function newResetSecret() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let secret = '';
  for (let index = 0; index < bytes.length; index += 1) {
    secret += alphabet[bytes[index] % alphabet.length];
    if (index === 3 || index === 7 || index === 11) secret += '-';
  }
  return secret;
}

async function findAuthUserByUsername(username: string) {
  const { url, serviceKey } = supabaseConfig();
  const email = `${username}@club.local`;
  const { response, payload } = await rpcRequest(url, serviceKey, 'find_club_auth_user', {
    p_email: email
  });
  if (!response.ok) throw new Error('查找账号失败，请稍后重试。');
  const rows = Array.isArray(payload) ? payload : [];
  const matched = rows[0];
  if (!matched || typeof matched !== 'object' || typeof (matched as Record<string, unknown>).id !== 'string') {
    throw new Error('账号不存在。');
  }
  return matched as { id: string; email?: string };
}

async function updateAuthPassword(userId: string, password: string) {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload.message ||
      payload.msg ||
      payload.error_description ||
      payload.error ||
      '重置密码失败。'
    );
  }
  return payload?.user || payload;
}

async function expirePasswordResets(url: string, serviceKey: string) {
  const now = new Date().toISOString();
  await fetch(
    `${url}/rest/v1/club_password_resets?status=eq.approved&expires_at=lt.${encodeURIComponent(now)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal'
      },
      body: JSON.stringify({
        status: 'expired',
        secret_hash: null,
        updated_at: now
      })
    }
  );
}

async function requestPasswordReset(usernameInput: unknown) {
  const username = normalizeUsername(usernameInput);
  const user = await findAuthUserByUsername(username);
  const { url, serviceKey } = supabaseConfig();
  await expirePasswordResets(url, serviceKey);

  const existingPending = await fetch(
    `${url}/rest/v1/club_password_resets?user_id=eq.${encodeURIComponent(user.id)}&status=eq.pending&select=id&limit=1`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  const pendingRows = await existingPending.json().catch(() => []);
  if (Array.isArray(pendingRows) && pendingRows.length) {
    return {
      ok: true,
      username,
      message: '该账号已有待处理的重置申请，请等待管理员生成秘钥。'
    };
  }

  const response = await fetch(`${url}/rest/v1/club_password_resets`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: JSON.stringify({
      user_id: user.id,
      username,
      email: user.email || `${username}@club.local`,
      status: 'pending',
      note: '用户提交重置申请'
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (Array.isArray(payload) ? payload[0]?.message : payload?.message) ||
      '提交重置申请失败。'
    );
  }
  return {
    ok: true,
    username,
    message: '重置申请已提交，请等待管理员生成 24 小时有效秘钥。'
  };
}

async function listPasswordResets() {
  const { url, serviceKey } = supabaseConfig();
  await expirePasswordResets(url, serviceKey);
  const response = await fetch(
    `${url}/rest/v1/club_password_resets?select=id,user_id,username,email,status,secret_hint,requested_at,approved_at,expires_at,used_at,note,updated_at&order=requested_at.desc&limit=100`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error('读取密码重置申请失败。');
  return await response.json();
}

async function approvePasswordReset(adminUser: { id?: string }, requestId: unknown) {
  if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('缺少申请编号。');
  const { url, serviceKey } = supabaseConfig();
  await expirePasswordResets(url, serviceKey);

  const currentResponse = await fetch(
    `${url}/rest/v1/club_password_resets?id=eq.${encodeURIComponent(requestId.trim())}&select=*&limit=1`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  const currentRows = await currentResponse.json().catch(() => []);
  const current = Array.isArray(currentRows) ? currentRows[0] : null;
  if (!current) throw new Error('重置申请不存在。');
  if (current.status !== 'pending') throw new Error('该申请已处理，不能重复生成秘钥。');

  // 同一账号若已有未使用秘钥，先作废，保证一对一。
  await fetch(
    `${url}/rest/v1/club_password_resets?user_id=eq.${encodeURIComponent(current.user_id)}&status=eq.approved`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal'
      },
      body: JSON.stringify({
        status: 'cancelled',
        secret_hash: null,
        updated_at: new Date().toISOString(),
        note: '被新的重置秘钥替换'
      })
    }
  );

  const secret = newResetSecret();
  const secretHash = await sha256Hex(secret);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch(
    `${url}/rest/v1/club_password_resets?id=eq.${encodeURIComponent(requestId.trim())}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=representation'
      },
      body: JSON.stringify({
        status: 'approved',
        secret_hash: secretHash,
        secret_hint: `${secret.slice(0, 4)}****${secret.slice(-4)}`,
        approved_at: now.toISOString(),
        approved_by: adminUser?.id || null,
        expires_at: expiresAt,
        updated_at: now.toISOString(),
        note: '管理员已生成重置秘钥'
      })
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload) || !payload[0]) {
    throw new Error('生成重置秘钥失败。');
  }
  return {
    request: payload[0],
    secret,
    expiresAt,
    message: '已生成重置秘钥，请线下告知申请者。秘钥仅显示一次。'
  };
}

async function cancelPasswordReset(requestId: unknown) {
  if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('缺少申请编号。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_password_resets?id=eq.${encodeURIComponent(requestId.trim())}&status=in.(pending,approved)`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=representation'
      },
      body: JSON.stringify({
        status: 'cancelled',
        secret_hash: null,
        updated_at: new Date().toISOString(),
        note: '管理员已取消'
      })
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload) || !payload[0]) {
    throw new Error('取消失败，申请可能已失效。');
  }
  return { ok: true, request: payload[0] };
}

async function resetPasswordWithSecret(usernameInput: unknown, secretInput: unknown, passwordInput: unknown) {
  const username = normalizeUsername(usernameInput);
  const password = normalizePassword(passwordInput);
  if (typeof secretInput !== 'string' || !secretInput.trim()) throw new Error('请输入重置秘钥。');
  const secret = secretInput.trim().toUpperCase();
  const secretHash = await sha256Hex(secret);
  const { url, serviceKey } = supabaseConfig();
  await expirePasswordResets(url, serviceKey);

  const response = await fetch(
    `${url}/rest/v1/club_password_resets?username=eq.${encodeURIComponent(username)}&status=eq.approved&select=*&order=approved_at.desc&limit=1`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  const rows = await response.json().catch(() => []);
  const current = Array.isArray(rows) ? rows[0] : null;
  if (!current) throw new Error('没有可用的重置秘钥，请先申请并等待管理员生成。');
  if (!current.expires_at || new Date(current.expires_at).getTime() <= Date.now()) {
    throw new Error('重置秘钥已过期，请重新申请。');
  }
  if (current.secret_hash !== secretHash) throw new Error('重置秘钥不正确。');

  await updateAuthPassword(current.user_id, password);

  await fetch(
    `${url}/rest/v1/club_password_resets?id=eq.${encodeURIComponent(current.id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal'
      },
      body: JSON.stringify({
        status: 'used',
        secret_hash: null,
        used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        note: '用户已使用秘钥重置密码'
      })
    }
  );

  return {
    ok: true,
    username,
    message: '密码已重置成功，请使用新密码登录。'
  };
}

async function adminSetPassword(usernameInput: unknown, passwordInput: unknown) {
  const username = normalizeUsername(usernameInput);
  const password = normalizePassword(passwordInput);
  const user = await findAuthUserByUsername(username);
  await updateAuthPassword(user.id, password);

  const { url, serviceKey } = supabaseConfig();
  await fetch(
    `${url}/rest/v1/club_password_resets?user_id=eq.${encodeURIComponent(user.id)}&status=in.(pending,approved)`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal'
      },
      body: JSON.stringify({
        status: 'cancelled',
        secret_hash: null,
        updated_at: new Date().toISOString(),
        note: '管理员已直接改密，旧申请作废'
      })
    }
  );

  return {
    ok: true,
    username,
    message: `已直接重置账号 ${username} 的密码。`
  };
}

function asNonNegativeInt(value: unknown, label: string, max = 1000000) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > max) {
    throw new Error(`${label}必须是 0 到 ${max} 的整数。`);
  }
  return numeric;
}

function asPositiveInt(value: unknown, label: string, max = 1000000) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > max) {
    throw new Error(`${label}必须是 1 到 ${max} 的整数。`);
  }
  return numeric;
}

function asOptionalImageUrl(value: unknown) {
  const text = asOptionalText(value, 500);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) {
    throw new Error('配图请填写以 http:// 或 https:// 开头的完整图片 URL；留空表示无配图。');
  }
  return text;
}

function mallProductFields(payload: Record<string, unknown>, user: { id?: string } | null, isUpdate = false) {
  const name = asNonEmptyText(payload.name ?? payload.productName, '商品名称', 80);
  const description = asOptionalText(payload.description, 500);
  const imageUrl = asOptionalImageUrl(payload.imageUrl ?? payload.image_url);
  const price = asPositiveInt(payload.price, '兑换积分');
  const stock = asNonNegativeInt(payload.stock, '库存');
  const isListed = asBoolean(payload.isListed ?? payload.is_listed, false);
  const sortOrder = asNonNegativeInt(payload.sortOrder ?? payload.sort_order ?? 0, '排序', 100000);
  const now = new Date().toISOString();
  return {
    name,
    description,
    image_url: imageUrl,
    price,
    stock,
    is_listed: isListed,
    sort_order: sortOrder,
    updated_by: user?.id || null,
    updated_at: now,
    ...(isUpdate ? {} : { created_by: user?.id || null })
  };
}

async function listMallProducts(adminView = false) {
  const { url, serviceKey } = supabaseConfig();
  const filter = adminView ? '' : '&is_listed=eq.true&stock=gt.0';
  const response = await fetch(
    `${url}/rest/v1/club_mall_products?select=id,name,description,image_url,price,stock,is_listed,sort_order,created_at,updated_at${filter}&order=sort_order.asc,updated_at.desc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail.includes('Could not find the table') || detail.includes('relation')
      ? '积分商城表尚未创建，请先执行 club-mall-schema.sql。'
      : '读取商品列表失败。');
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function saveMallProduct(user: { id?: string } | null, payload: Record<string, unknown>) {
  const { url, serviceKey } = supabaseConfig();
  const id = payload.id;
  const isUpdate = validUuid(id);
  const fields = mallProductFields(payload, user, isUpdate);
  const response = await fetch(
    isUpdate
      ? `${url}/rest/v1/club_mall_products?id=eq.${encodeURIComponent(String(id))}`
      : `${url}/rest/v1/club_mall_products`,
    {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(fields)
    }
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result === 'object' && result && 'message' in result
      ? String((result as { message?: string }).message || '')
      : '';
    throw new Error(detail || (isUpdate ? '保存商品失败。' : '添加商品失败。'));
  }
  if (isUpdate && (!Array.isArray(result) || result.length !== 1)) throw new Error('未找到需要修改的商品。');
  return Array.isArray(result) ? result[0] : result;
}

async function deleteMallProduct(id: unknown) {
  if (!validUuid(id)) throw new Error('商品编号不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_mall_products?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('删除商品失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到需要删除的商品。');
  return { ok: true };
}

function showcaseMemberFields(payload: Record<string, unknown>, user: { id?: string } | null, isUpdate = false) {
  const name = asNonEmptyText(payload.name ?? payload.memberName, '姓名', 40);
  const memberClass = asOptionalText(payload.memberClass ?? payload.member_class ?? payload.grade, 80);
  const intro = asOptionalText(payload.intro ?? payload.description, 500);
  const imageUrl = asOptionalImageUrl(payload.imageUrl ?? payload.image_url ?? payload.avatarImage);
  const isVisible = asBoolean(payload.isVisible ?? payload.is_visible, true);
  const sortOrder = asNonNegativeInt(payload.sortOrder ?? payload.sort_order ?? 0, '排序', 100000);
  const now = new Date().toISOString();
  return {
    name,
    member_class: memberClass,
    intro,
    image_url: imageUrl,
    is_visible: isVisible,
    sort_order: sortOrder,
    updated_by: user?.id || null,
    updated_at: now,
    ...(isUpdate ? {} : { created_by: user?.id || null })
  };
}

async function listShowcaseMembers(adminView = false) {
  const { url, serviceKey } = supabaseConfig();
  const filter = adminView ? '' : '&is_visible=eq.true';
  const response = await fetch(
    `${url}/rest/v1/club_showcase_members?select=id,name,member_class,intro,image_url,is_visible,sort_order,created_at,updated_at${filter}&order=sort_order.asc,updated_at.desc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail.includes('Could not find the table') || detail.includes('relation')
      ? '成员展示表尚未创建，请先执行 club-showcase-members-schema.sql。'
      : '读取成员展示列表失败。');
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function saveShowcaseMember(user: { id?: string } | null, payload: Record<string, unknown>) {
  const { url, serviceKey } = supabaseConfig();
  const id = payload.id;
  const isUpdate = validUuid(id);
  const fields = showcaseMemberFields(payload, user, isUpdate);
  const response = await fetch(
    isUpdate
      ? `${url}/rest/v1/club_showcase_members?id=eq.${encodeURIComponent(String(id))}`
      : `${url}/rest/v1/club_showcase_members`,
    {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(fields)
    }
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result === 'object' && result && 'message' in result
      ? String((result as { message?: string }).message || '')
      : '';
    throw new Error(detail || (isUpdate ? '保存成员展示失败。' : '添加成员展示失败。'));
  }
  if (isUpdate && (!Array.isArray(result) || result.length !== 1)) throw new Error('未找到需要修改的成员展示。');
  return Array.isArray(result) ? result[0] : result;
}

async function deleteShowcaseMember(id: unknown) {
  if (!validUuid(id)) throw new Error('成员展示编号不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_showcase_members?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('删除成员展示失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到需要删除的成员展示。');
  return { ok: true };
}

const JOIN_CONTACT_TYPES = new Set(['wechat', 'phone', 'qq', 'email']);

function joinContactValue(contactType: string, value: unknown) {
  const text = asNonEmptyText(value, '联系方式', 120);
  if (contactType === 'phone' && !/^\d{6,20}$/.test(text)) {
    throw new Error('手机号格式不正确，请填写 6 到 20 位数字。');
  }
  if (contactType === 'qq' && !/^\d{5,15}$/.test(text)) {
    throw new Error('QQ 号格式不正确，请填写 5 到 15 位数字。');
  }
  if (contactType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    throw new Error('邮箱格式不正确。');
  }
  if (contactType === 'wechat' && !/^[A-Za-z][-_A-Za-z0-9]{5,19}$/.test(text) && !/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,40}$/.test(text)) {
    throw new Error('微信号格式不正确。');
  }
  return text;
}

function joinApplicationFields(payload: Record<string, unknown>) {
  const chineseName = courseMemberName(payload.chineseName ?? payload.chinese_name ?? payload.memberName ?? payload.name);
  const memberClass = asNonEmptyText(payload.memberClass ?? payload.member_class ?? payload.className, '班级', 80);
  const contactTypeRaw = asNonEmptyText(payload.contactType ?? payload.contact_type, '联系方式类型', 20).toLowerCase();
  if (!JOIN_CONTACT_TYPES.has(contactTypeRaw)) throw new Error('联系方式类型不合法。');
  const contactValue = joinContactValue(contactTypeRaw, payload.contactValue ?? payload.contact_value ?? payload.contact);
  return {
    chinese_name: chineseName,
    member_class: memberClass,
    contact_type: contactTypeRaw,
    contact_value: contactValue,
    self_intro: asOptionalText(payload.selfIntro ?? payload.self_intro, 500),
    attraction: asOptionalText(payload.attraction, 500),
    expectation: asOptionalText(payload.expectation, 500)
  };
}

async function createJoinApplication(payload: Record<string, unknown>) {
  const fields = joinApplicationFields(payload);
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_join_applications`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(fields)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result === 'object' && result && 'message' in result
      ? String((result as { message?: string }).message || '')
      : '';
    throw new Error(
      detail.includes('Could not find the table') || detail.includes('relation')
        ? '报名表尚未创建，请先执行 club-join-applications-schema.sql。'
        : (detail || '提交报名失败。')
    );
  }
  return Array.isArray(result) ? result[0] : result;
}

async function listJoinApplications() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_join_applications?select=id,chinese_name,member_class,contact_type,contact_value,self_intro,attraction,expectation,created_at&order=created_at.desc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail.includes('Could not find the table') || detail.includes('relation')
      ? '报名表尚未创建，请先执行 club-join-applications-schema.sql。'
      : '读取报名列表失败。');
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function deleteJoinApplication(id: unknown) {
  if (!validUuid(id)) throw new Error('报名记录编号不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_join_applications?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('删除报名记录失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到需要删除的报名记录。');
  return { ok: true };
}

async function redeemMallProduct(user: { id?: string; email?: string } | null, productId: unknown) {
  if (!user?.id) throw new Error('您还不是算法社社员！');
  if (!validUuid(productId)) throw new Error('商品编号不合法。');
  const username = typeof user.email === 'string' && user.email.includes('@')
    ? user.email.split('@')[0]
    : (typeof user.email === 'string' ? user.email : '');
  const { url, serviceKey } = supabaseConfig();
  const { response, payload } = await rpcRequest(url, serviceKey, 'redeem_club_mall_product', {
    p_user_id: user.id,
    p_username: username,
    p_product_id: productId
  });
  if (!response.ok) {
    const message = (payload as { message?: string; error?: string; hint?: string } | null)?.message
      || (payload as { message?: string; error?: string; hint?: string } | null)?.error
      || (payload as { message?: string; error?: string; hint?: string } | null)?.hint
      || '兑换失败。';
    throw new Error(message);
  }
  return payload;
}

async function listMallRedemptions() {
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/club_mall_redemptions?select=id,product_id,product_name,product_price,user_id,username,member_name,member_class,points_spent,created_at&order=created_at.desc`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail.includes('Could not find the table') || detail.includes('relation')
      ? '积分商城表尚未创建，请先执行 club-mall-schema.sql。'
      : '读取兑换记录失败。');
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function deleteMallRedemption(id: unknown) {
  if (!validUuid(id)) throw new Error('兑换记录编号不合法。');
  const { url, serviceKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/club_mall_redemptions?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('标记已处理失败。');
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('未找到该兑换记录。');
  return { ok: true };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['GET', 'POST'].includes(request.method)) return json({ error: '只支持 GET、POST 请求。' }, 405);

  try {
    const streamAction = request.headers.get('x-drive-action');
    if (request.method === 'POST' && streamAction === 'upload') {
      const user = await getUser(request);
      if (!user?.id) return json({ error: '请先登录社团盘。' }, 401);
      const length = contentLength(request);
      if (length !== null && length > MAX_FILE_BYTES) return json({ error: '单个文件不能超过 100 MiB。' }, 413);
      if (!request.body) return json({ error: '上传内容不完整。' }, 400);
      const response = await webdavRequest('PUT', filePathFor(userRoot(user.id), headerPath(request)), { headers: { 'content-type': request.headers.get('x-drive-content-type') || 'application/octet-stream', ...(length === null ? {} : { 'content-length': String(length) }) }, body: request.body });
      if (!response.ok) return json({ error: `上传失败（${response.status}）。` }, 502);
      return json({ ok: true, bytes: length });
    }

    const user = request.method === 'GET' || request.method === 'POST' ? await getUser(request) : null;
    if (request.method === 'GET' && streamAction === 'download') {
      if (!user?.id) return json({ error: '请先登录社团盘。' }, 401);
      const response = await webdavRequest('GET', filePathFor(userRoot(user.id), headerPath(request)));
      if (!response.ok) return json({ error: `下载失败（${response.status}）。` }, 502);
      const length = Number(response.headers.get('content-length'));
      if (Number.isSafeInteger(length) && length > MAX_FILE_BYTES) return json({ error: '单个文件不能超过 100 MiB。' }, 413);
      if (!response.body) return json({ error: '下载内容为空。' }, 502);
      const headers = new Headers(corsHeaders);
      headers.set('content-type', response.headers.get('content-type') || 'application/octet-stream');
      if (response.headers.has('content-length')) headers.set('content-length', response.headers.get('content-length')!);
      headers.set('content-disposition', `attachment; filename="${encodeURIComponent(relativePath(headerPath(request)).pop() || 'download')}"`);
      if (Number.isSafeInteger(length)) headers.set('x-drive-bytes', String(length));
      return new Response(response.body, { status: 200, headers });
    }

    if (request.method !== 'POST') return json({ error: '请求参数不完整。' }, 400);
    const payload = await request.json().catch(() => ({}));

    if (payload.action === 'signup') return json(await createMember(payload.username, payload.password, payload.inviteCode));
    if (payload.action === 'join_application_create') {
      return json({
        application: await createJoinApplication(payload),
        message: '报名已提交，我们会尽快联系你。'
      });
    }
    if (payload.action === 'password_reset_request') {
      return json(await requestPasswordReset(payload.username));
    }
    if (payload.action === 'password_reset_with_secret') {
      return json(await resetPasswordWithSecret(payload.username, payload.secret, payload.password));
    }
    if (payload.action === 'member_points_list') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json({ members: await listMemberPoints() });
    }

    if (payload.action === 'member_profile_get') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json(await getMemberProfile(user));
    }

    if (payload.action === 'member_profile_bind') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json(await bindMemberProfile(user, payload.memberName, payload.memberClass));
    }

    if (payload.action === 'member_theme_get') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      try {
        return json(await getMemberThemePreference(user));
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : '读取主题偏好失败。' }, 400);
      }
    }
    if (payload.action === 'member_theme_set') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      try {
        return json(await setMemberThemePreference(user, payload.themeMode ?? payload.theme_mode));
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : '保存主题偏好失败。' }, 400);
      }
    }

    if (payload.action === 'admin_member_profiles_list') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      const profiles = await listMemberProfiles();
      const boundCount = profiles.filter((item) => Boolean(item.bound)).length;
      return json({
        profiles,
        total: profiles.length,
        boundCount
      });
    }
    if (payload.action === 'admin_member_profile_bind') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await adminBindMemberProfile(payload.username, payload.memberName, payload.memberClass));
    }
    if (payload.action === 'admin_password_resets_list') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ resets: await listPasswordResets() });
    }
    if (payload.action === 'admin_password_reset_approve') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await approvePasswordReset(user, payload.requestId));
    }
    if (payload.action === 'admin_password_reset_cancel') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await cancelPasswordReset(payload.requestId));
    }
    if (payload.action === 'admin_password_set') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await adminSetPassword(payload.username, payload.password));
    }

    if (payload.action === 'staff_access_get') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json(await getUserAccess(user));
    }
    if (payload.action === 'site_service_status') {
      const { url, serviceKey } = supabaseConfig();
      const { response, payload: result } = await rpcRequest(url, serviceKey, 'club_site_service_status', {});
      if (!response.ok) throw new Error('读取网站服务状态失败。');
      const row = Array.isArray(result) ? result[0] : result;
      return json(row || { enabled: true });
    }
    if (payload.action === 'appmonitor_releases_list') {
      return json({ releases: await listAppMonitorReleases() });
    }
    if (payload.action === 'admin_appmonitor_releases_list') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ releases: await listAppMonitorReleases() });
    }
    if (payload.action === 'admin_appmonitor_releases_save') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ release: await saveAppMonitorRelease(user, payload) });
    }
    if (payload.action === 'admin_appmonitor_releases_delete') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await deleteAppMonitorRelease(payload.id));
    }
    if (payload.action === 'admin_site_service_get' || payload.action === 'admin_site_service_set') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      const { url, serviceKey } = supabaseConfig();
      if (payload.action === 'admin_site_service_get') {
        const { response, payload: result } = await rpcRequest(url, serviceKey, 'club_site_service_status', {});
        if (!response.ok) throw new Error('读取网站服务状态失败。');
        return json(Array.isArray(result) ? (result[0] || {}) : (result || {}));
      }
      const { response, payload: result } = await rpcRequest(url, serviceKey, 'club_site_service_set', {
        p_enabled: Boolean(payload.enabled), p_random_enabled: Boolean(payload.randomEnabled), p_title_zh: payload.titleZh, p_subtitle_zh: payload.subtitleZh,
        p_title_en: payload.titleEn, p_subtitle_en: payload.subtitleEn, p_report_zh: payload.reportZh, p_report_en: payload.reportEn, p_feature_settings: payload.featureSettings || null, p_updated_by: user?.id || null
      });
      if (!response.ok) throw new Error('保存网站服务状态失败。');
      return json({ ok: Array.isArray(result) ? result[0] : result });
    }
    if (payload.action === 'admin_staff_permissions_list') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ permissions: await listStaffPermissions() });
    }
    if (payload.action === 'admin_staff_permissions_save') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({
        permission: await upsertStaffPermissions(user, payload.username, {
          can_checkin: payload.can_checkin,
          can_points: payload.can_points,
          can_messages: payload.can_messages,
          can_invites: payload.can_invites,
          can_events: payload.can_events,
          can_mall: payload.can_mall,
          can_members: payload.can_members,
          can_join: payload.can_join
        }, payload.note)
      });
    }
    if (payload.action === 'admin_staff_permissions_delete') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await deleteStaffPermissions(payload.username));
    }
    if (payload.action === 'admin_super_admins_list') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ superAdmins: await listSuperAdmins() });
    }
    if (payload.action === 'admin_super_admins_promote') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({
        superAdmin: await promoteSuperAdmin(user, payload.username, payload.note),
        message: '已升级为超管。'
      });
    }
    if (payload.action === 'admin_super_admins_revoke') {
      try { await requireSuperAdmin(user); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({
        ...(await revokeSuperAdmin(user, payload.username)),
        message: '已撤销超管权限。'
      });
    }
    if (payload.action === 'public_home_feed') {
      return json(await publicHomeFeed());
    }
    if (payload.action === 'announcements_list') {
      return json({ announcements: await listAnnouncements(false) });
    }
    if (payload.action === 'events_list') {
      return json({ events: await listEvents(false) });
    }
    if (payload.action === 'event_signup') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json({
        signup: await signupEvent(
          user,
          payload.eventId,
          payload.memberName,
          payload.memberClass,
          payload.contact,
          payload.note
        )
      });
    }
    if (payload.action === 'admin_announcements_list') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ announcements: await listAnnouncements(true) });
    }
    if (payload.action === 'admin_announcements_save') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ announcement: await saveAnnouncement(user, payload) });
    }
    if (payload.action === 'admin_announcements_delete') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await deleteAnnouncement(payload.id));
    }
    if (payload.action === 'admin_announcements_repush_home') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await repushHomeFeatured('announcement', payload.id, user));
    }
    if (payload.action === 'admin_events_list') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ events: await listEvents(true) });
    }
    if (payload.action === 'admin_events_save') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ event: await saveEvent(user, payload) });
    }
    if (payload.action === 'admin_events_delete') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await deleteEvent(payload.id));
    }
    if (payload.action === 'admin_events_repush_home') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await repushHomeFeatured('event', payload.id, user));
    }
    if (payload.action === 'admin_event_signups_list') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ signups: await listEventSignups(payload.eventId) });
    }
    if (payload.action === 'admin_event_signup_update') {
      try { await requirePermission(user, 'events'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ signup: await updateEventSignupStatus(payload.id, payload.status) });
    }

    if (payload.action === 'mall_products_list') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json({ products: await listMallProducts(false) });
    }
    if (payload.action === 'mall_redeem') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json(await redeemMallProduct(user, payload.productId ?? payload.id));
    }
    if (payload.action === 'admin_mall_products_list') {
      try { await requirePermission(user, 'mall'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ products: await listMallProducts(true) });
    }
    if (payload.action === 'admin_mall_products_save') {
      try { await requirePermission(user, 'mall'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ product: await saveMallProduct(user, payload) });
    }
    if (payload.action === 'admin_mall_products_delete') {
      try { await requirePermission(user, 'mall'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await deleteMallProduct(payload.id));
    }
    if (payload.action === 'admin_mall_redemptions_list') {
      try { await requirePermission(user, 'mall'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ redemptions: await listMallRedemptions() });
    }
    if (payload.action === 'admin_mall_redemption_delete') {
      try { await requirePermission(user, 'mall'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await deleteMallRedemption(payload.id));
    }

    if (payload.action === 'showcase_members_list') {
      try {
        return json({ members: await listShowcaseMembers(false) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : '读取成员展示失败。' }, 500);
      }
    }
    if (payload.action === 'admin_showcase_members_list') {
      try { await requirePermission(user, 'members'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ members: await listShowcaseMembers(true) });
    }
    if (payload.action === 'admin_showcase_members_save') {
      try { await requirePermission(user, 'members'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ member: await saveShowcaseMember(user, payload) });
    }
    if (payload.action === 'admin_showcase_members_delete') {
      try { await requirePermission(user, 'members'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await deleteShowcaseMember(payload.id));
    }

    if (payload.action === 'admin_join_applications_list') {
      try { await requirePermission(user, 'join'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ applications: await listJoinApplications() });
    }
    if (payload.action === 'admin_join_applications_delete') {
      try { await requirePermission(user, 'join'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await deleteJoinApplication(payload.id));
    }

    if (payload.action === 'member_messages_list') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json({ messages: await listMemberMessages() });
    }
    if (payload.action === 'member_messages_create') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json({ message: await createMemberMessage(payload.memberName, payload.memberClass, payload.messageContent) });
    }
    if (payload.action === 'member_checkin') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json({ result: await redeemCheckin(user, payload.code, payload.memberName) });
    }
    if (payload.action === 'member_course_checkin') {
      if (!user?.id) return json({ error: '您还不是算法社社员！' }, 401);
      return json({ request: await submitCourseCheckin(user, payload.memberName) });
    }
    if (!user?.id) return json({ error: '请先登录社团盘。' }, 401);

    if (payload.action === 'admin_generate_invites') {
      try { await requirePermission(user, 'invites'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ codes: await createInvites(payload.count) });
    }
    if (payload.action === 'admin_list_invites') {
      try { await requirePermission(user, 'invites'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ invites: await listInvites() });
    }
    if (payload.action === 'admin_member_points_save') {
      try { await requirePermission(user, 'points'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ member: await saveMemberPoints(payload.id, payload.memberName, payload.memberClass, payload.points) });
    }
    if (payload.action === 'admin_member_points_delete') {
      try { await requirePermission(user, 'points'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      await deleteMemberPoints(payload.id);
      return json({ ok: true });
    }
    if (payload.action === 'admin_member_messages_update') {
      try { await requirePermission(user, 'messages'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ message: await updateMemberMessage(payload.id, payload.memberName, payload.memberClass, payload.messageContent) });
    }
    if (payload.action === 'admin_member_messages_delete') {
      try { await requirePermission(user, 'messages'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      await deleteMemberMessage(payload.id);
      return json({ ok: true });
    }
    if (payload.action === 'admin_checkin_create') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ checkinCode: await createCheckinCode(user, payload.points, payload.usageMode, payload.expiresAt) });
    }
    if (payload.action === 'admin_checkin_list') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await listCheckinCodes());
    }
    if (payload.action === 'admin_checkin_pending_list') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ pending: await listPendingCheckins() });
    }
    if (payload.action === 'admin_checkin_pending_resolve') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      await resolvePendingCheckin(payload.id);
      return json({ ok: true });
    }
    if (payload.action === 'admin_course_checkin_list') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ requests: await listCourseCheckins() });
    }
    if (payload.action === 'admin_course_attendance_list') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json(await listCourseAttendance(payload.date));
    }
    if (payload.action === 'admin_course_checkin_approve') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ result: await approveCourseCheckin(payload.id) });
    }
    if (payload.action === 'admin_course_checkin_reject') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      await rejectCourseCheckin(payload.id);
      return json({ ok: true });
    }
    if (payload.action === 'admin_course_checkin_add_member') {
      try { await requirePermission(user, 'checkin'); } catch (error) { return json({ error: error instanceof Error ? error.message : '无权限。' }, 403); }
      return json({ result: await addCourseCheckinMember(payload.id, payload.memberClass) });
    }

    const root = userRoot(user.id);
    const currentPath = pathFor(root, payload.path, true);
    if (payload.action === 'list') {
      let response = await webdavRequest('PROPFIND', currentPath, { headers: { depth: '1', 'content-type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>' });
      if (response.status === 404 && !payload.path) {
        const createResponse = await webdavRequest('MKCOL', root);
        if (!createResponse.ok && createResponse.status !== 405) return json({ error: `创建用户目录失败（${createResponse.status}）。` }, 502);
        response = await webdavRequest('PROPFIND', currentPath, { headers: { depth: '1', 'content-type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>' });
      }
      if (!response.ok && response.status !== 207) return json({ error: `WebDAV 读取失败（${response.status}）。` }, 502);
      return json({ path: relativePath(payload.path).join('/'), files: parseXmlFiles(await response.text()) });
    }
    if (payload.action === 'mkdir') {
      if (typeof payload.name !== 'string' || !/^[^/\\.\0]{1,80}$/.test(payload.name) || payload.name === '..') return json({ error: '文件夹名称不合法。' }, 400);
      const response = await webdavRequest('MKCOL', pathFor(root, `${typeof payload.path === 'string' ? payload.path : ''}/${payload.name}`, true));
      if (!response.ok && response.status !== 405) return json({ error: `创建文件夹失败（${response.status}）。` }, 502);
      return json({ ok: true });
    }
    if (payload.action === 'delete') {
      const response = await webdavRequest('DELETE', filePathFor(root, payload.path));
      if (!response.ok && response.status !== 204) return json({ error: `删除失败（${response.status}）。` }, 502);
      return json({ ok: true });
    }
    return json({ error: '暂不支持的社团盘操作。' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '社团盘服务异常。' }, 400);
  }
});
