/*
 * club-auth-storage.js — 让登录态在 file:// 打开的页面之间也能复用
 *
 * 背景：Supabase 把会话按「origin」写入 localStorage。http(s) 下的 origin 是
 * https://…，而 file:// 页面的 origin 是 null，两者不共享存储；因此用本地文件
 * 打开 admin-hub / chat-admin 时会读到空会话，所有管理请求都会 401。
 *
 * 做法：登录成功后把会话快照写入 sessionStorage（同一标签页内 file:// 页面共享），
 * 页面启动时若发现 localStorage 没有会话就用它恢复。这只是本地开发便利，
 * 不改任何服务端授权：所有请求仍要用真实 access_token 校验超管身份。
 */
(function () {
  'use strict';
  var KEY = 'club-file-session';
  var isFile = location.protocol === 'file:';
  var URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
  var ANON = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';

  function read() {
    try {
      var raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) { return null; }
  }

  function save(session) {
    try {
      if (session && session.access_token) {
        // 只保存恢复所需字段，避免把整份会话（含大体积元数据）复制出去。
        sessionStorage.setItem(KEY, JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at || null,
          user: session.user ? { id: session.user.id, email: session.user.email || null } : null
        }));
      } else {
        sessionStorage.removeItem(KEY);
      }
    } catch (_error) { /* storage unavailable */ }
  }

  window.ClubFileSession = { read: read, save: save };

  // 包装 createClient：暴露的 auth 仍走官方实现，只是在 getSession 结果为空时
  // 用本地快照恢复一次。
  // http(s) 下也会持续写入快照，这样同一浏览器切到 file:// 打开时能直接恢复，
  // 不必重新登录。
  var originalCreateClient = window.supabase && window.supabase.createClient;
  if (typeof originalCreateClient === 'function' && !originalCreateClient.__clubWrapped) {
    var wrapped = function (url, key, options) {
      var client = originalCreateClient.call(window.supabase, url, key, options);
      var auth = client.auth;
      var originalGetSession = auth.getSession.bind(auth);
      var originalSetSession = auth.setSession.bind(auth);
      var originalSignOut = auth.signOut.bind(auth);

      auth.getSession = async function () {
        var result = await originalGetSession();
        if (result && result.data && result.data.session) {
          save(result.data.session);
          return result;
        }
        if (!isFile) return result;
        var cached = read();
        if (cached && cached.access_token && cached.refresh_token) {
          try {
            var restored = await originalSetSession({ access_token: cached.access_token, refresh_token: cached.refresh_token });
            if (restored && restored.data && restored.data.session) {
              save(restored.data.session);
              return { data: { session: restored.data.session }, error: null };
            }
          } catch (_error) { /* fall through to empty session */ }
        }
        return result;
      };

      auth.signOut = async function () {
        save(null);
        return originalSignOut();
      };

      // setSession（登录后）也要落盘
      auth.setSession = async function (tokens) {
        var result = await originalSetSession(tokens);
        if (result && result.data && result.data.session) save(result.data.session);
        return result;
      };
      return client;
    };
    wrapped.__clubWrapped = true;
    window.supabase.createClient = wrapped;
  }
})();
