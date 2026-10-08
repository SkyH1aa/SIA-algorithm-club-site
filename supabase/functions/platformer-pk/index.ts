import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Body = {
  action?: string;
  username?: string;
  token?: string;
  args?: Record<string, unknown>;
};

// This file is intentionally server-only. Do not paste platformer-pk.js here:
// the browser module references document, window and canvas APIs.

const allowed = new Set([
  'platformer_pk_create_room',
  'platformer_pk_join_room',
  'platformer_pk_room_snapshot',
  'platformer_pk_accept_invite',
  'platformer_pk_lock_wager',
  'platformer_pk_set_ready',
  'platformer_pk_submit_result',
  'platformer_pk_leave_room',
]);

Deno.serve(async (request) => {
  console.log('[platformer-pk] server gateway online');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: '仅支持 POST' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const body = await request.json() as Body;
    const action = String(body.action || '');
    const username = String(body.username || '');
    const token = String(body.token || '');
    if (!allowed.has(action) || !username || !token) throw new Error('请求参数无效');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Edge Function 未配置 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const params: Record<string, unknown> = { p_username: username, p_token: token, ...(body.args || {}) };
    const { data, error } = await supabase.rpc(action, params);
    if (error) throw error;
    return new Response(JSON.stringify({ data, server: 'platformer-pk-authoritative-v2' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器处理失败';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
