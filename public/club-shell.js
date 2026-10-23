/*
 * club-shell.js — 算法社次级页面的共享交互层
 *
 * 提供：
 *   · 模块启动器（Ctrl/⌘ + K）：全站功能与后台模块的键盘跳转
 *   · 顶栏启动按钮自动挂载
 *   · 页内标签页（[data-club-tabs]）
 *   · 长页面章节导航（.club-section-nav）高亮
 *   · 回到顶部
 *   · 小屏幕下把顶栏溢出项收入启动器
 *
 * 依赖：无。ClubI18n / ClubTheme 存在时自动复用它们的文案与主题状态。
 * 约定：脚本放在 </body> 前；不需要 defer。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'algorithm-club-launcher-recents';
  var shellScriptURL = document.currentScript && document.currentScript.src;

  function mountAssistantLauncher() {
    if (!shellScriptURL || document.querySelector('script[data-club-assistant-loader]')) return;
    var script = document.createElement('script');
    script.src = new URL('assistant-launcher.js', shellScriptURL).href;
    script.setAttribute('data-club-assistant-loader', '');
    document.head.appendChild(script);
  }

  function t(key, fallback) {
    var value = global.ClubI18n && typeof global.ClubI18n.t === 'function'
      ? global.ClubI18n.t(key)
      : '';
    return value && value !== key ? value : (fallback || '');
  }

  function lang() {
    try {
      return global.ClubI18n && typeof global.ClubI18n.getLang === 'function'
        ? global.ClubI18n.getLang()
        : 'zh';
    } catch (_error) {
      return 'zh';
    }
  }

  function rootPath() {
    // 所有次级页面都在 /public/ 下；从目录层级推导到站点根。
    var path = location.pathname;
    if (/\/(?:public\/)?[^/]*$/.test(path) && /\/public\//.test(path)) {
      return '../';
    }
    return './';
  }

  function inPublicDir() {
    return /\/public\//.test(location.pathname);
  }

  var ITEMS = [
    { group: 'learn', icon: '◉', href: 'index.html', root: true, zh: '官网首页', en: 'Home', descZh: '3D 星图、能力矩阵与旗舰作品', descEn: '3D star chart, capability matrix, flagship work', keys: 'home 首页 官网' },
    { group: 'learn', icon: '◈', href: 'index.html#capabilities', root: true, zh: '实力 · 能力矩阵', en: 'Proof · Capability matrix', descZh: '竞赛、工程、AI、数学与教学工具链', descEn: 'Competition, engineering, AI, math, toolchain', keys: 'proof 实力 能力矩阵 capability' },
    { group: 'learn', icon: '社', href: 'club-features.html', zh: '社团功能总览', en: 'Club features', descZh: '所有社员功能与实验室的统一入口', descEn: 'Every member feature and lab in one place', keys: 'features 功能 总览' },
    { group: 'learn', icon: '⇅', href: 'visualization-lab.html', zh: '算法实验室', en: 'Algorithm labs', descZh: '排序、搜索、图论、DP、树与堆', descEn: 'Sorting, search, graphs, DP, trees, heaps', keys: 'lab 实验室 可视化' },
    { group: 'learn', icon: '▤', href: 'resources.html', zh: '教学资源', en: 'Resources', descZh: 'Python / C++ 教材与答案解析', descEn: 'Python / C++ textbooks and solutions', keys: 'resource 教材 资源 pdf' },
    { group: 'learn', icon: '◷', href: 'events.html', zh: '活动与公告', en: 'Events', descZh: '通知、课程安排、比赛与报名', descEn: 'Notices, schedules, contests, sign-up', keys: 'events 活动 公告' },
    { group: 'learn', icon: '☰', href: 'guide.html', zh: '使用指引', en: 'Guide', descZh: '第一次使用从这里开始', descEn: 'Start here on your first visit', keys: 'guide 指引 帮助' },
    { group: 'learn', icon: '↻', href: 'changelog.html', zh: '更新日志', en: 'Changelog', descZh: '官网功能更新与维护记录', descEn: 'Product updates and maintenance log', keys: 'changelog 更新 日志' },

    { group: 'play', icon: '◎', href: 'gomoku.html', zh: 'AI 五子棋', en: 'Gomoku AI', descZh: '人机挑战、模型对战与排行榜', descEn: 'Play humans, AIs, and leaderboards', keys: 'gomoku 五子棋 ai' },
    { group: 'play', icon: '◧', href: 'tetris.html', zh: '俄罗斯方块', en: 'Tetris', descZh: '四模式、AI 辅助与双排行榜', descEn: 'Four modes, AI assist, dual leaderboards', keys: 'tetris 俄罗斯方块' },
    { group: 'play', icon: '⌁', href: 'snake.html', zh: 'AI 贪吃蛇', en: 'Snake AI', descZh: 'AI 演示、辅助轨迹与人机对战', descEn: 'AI demo, trail assist, versus mode', keys: 'snake 贪吃蛇' },
    { group: 'play', icon: '▶', href: 'platformer.html', zh: '行于无垠', en: 'Boundless Run', descZh: '横屏闯关射击游戏', descEn: 'Side-scrolling action shooter', keys: 'platformer 行于无垠 游戏' },
    { group: 'play', icon: '✦', href: 'gomoku-satori-lab.html', zh: 'Satori 决策剖析', en: 'Satori lab', descZh: '逐步摊开自研 AI 的每一次决策', descEn: 'Every decision of the in-house AI, exposed', keys: 'satori 剖析 五子棋 决策' },

    { group: 'admin', icon: '▤', href: 'drive-admin.html', zh: '社团盘管理', en: 'Drive quota', descZh: '设置用户社团盘容量上限', descEn: 'Per-user Club Drive storage limits', keys: 'drive quota 社团盘 容量 配额', requires: 'super' },
    { group: 'member', icon: '◔', href: 'notifications.html', zh: '通知中心', en: 'Notifications', descZh: '公告、活动、报名与积分提醒', descEn: 'Announcements, events, signups and points', keys: 'notify 通知 消息 提醒' },
    { group: 'member', icon: '◇', href: 'search.html', zh: '站内搜索', en: 'Site search', descZh: '搜索社员、公告、活动与商品', descEn: 'Search members, announcements, events and products', keys: 'search 搜索 查找' },
    { group: 'member', icon: '◍', href: 'member-center.html', zh: '个人中心', en: 'Member center', descZh: '登录、注册与资料绑定', descEn: 'Sign in, register, bind profile', keys: 'member 个人中心 登录 注册' },
    { group: 'member', icon: '▣', href: 'member-points.html', zh: '社员积分', en: 'Points', descZh: '积分公示与管理员维护', descEn: 'Public points board and admin tools', keys: 'points 积分 排行' },
    { group: 'member', icon: '◷', href: 'member-checkin.html?type=course', zh: '签到兑换', en: 'Check-in', descZh: '签到码兑换积分或提交课程签到', descEn: 'Redeem codes or submit course check-in', keys: 'checkin 签到 兑换' },
    { group: 'member', icon: '▦', href: 'points-mall.html', zh: '积分商城', en: 'Points mall', descZh: '用积分兑换实物或权益', descEn: 'Redeem points for rewards', keys: 'mall 商城 兑换' },
    { group: 'member', icon: '✉', href: 'member-messages.html', zh: '社员留言箱', en: 'Inbox', descZh: '提交建议并查看社团留言', descEn: 'Suggestions and club messages', keys: 'messages 留言' },
    { group: 'member', icon: '▤', href: 'drive.html', zh: '社团盘', en: 'Club drive', descZh: '123 云盘专属目录', descEn: 'Your 123 cloud drive folder', keys: 'drive 网盘 社团盘' },
    { group: 'member', icon: '♥', href: 'donations.html', zh: '捐赠名单', en: 'Donations', descZh: '社团捐赠记录与金额排序', descEn: 'Club donation records by amount', keys: 'donation 捐赠 名单 金额' },
    { group: 'member', icon: '✦', href: 'chat.html', zh: '社团 AI Chat', en: 'Club AI Chat', descZh: '与社团 AI 对话', descEn: 'Chat with the club assistant', keys: 'chat ai 对话' },
    { group: 'member', icon: '⚿', href: 'password-reset.html', zh: '重置密码', en: 'Password reset', descZh: '提交申请或使用秘钥改密', descEn: 'Request or complete a reset', keys: 'password 密码 重置' },

    { group: 'admin', icon: '⌂', href: 'admin-hub.html', requires: 'staff', zh: '管理员总览', en: 'Admin hub', descZh: '全部管理模块与账号权限', descEn: 'All admin modules and permissions', keys: 'admin 管理员 后台' },
    { group: 'admin', icon: '▤', href: 'members-admin.html', requires: 'members', zh: '成员展示管理', en: 'Showcase admin', descZh: '首页成员卡片', descEn: 'Homepage member cards', keys: 'members 成员 展示' },
    { group: 'admin', icon: '◷', href: 'events-admin.html', requires: 'events', zh: '活动与公告管理', en: 'Events admin', descZh: '公告、活动、报名名单', descEn: 'Notices, events, sign-ups', keys: 'events 活动 公告 管理' },
    { group: 'admin', icon: '◈', href: 'mall-admin.html', requires: 'mall', zh: '积分商城管理', en: 'Mall admin', descZh: '商品、库存与兑换记录', descEn: 'Products, stock, redemptions', keys: 'mall 商城 管理' },
    { group: 'admin', icon: '✎', href: 'join-admin.html', requires: 'join', zh: '报名管理', en: 'Join admin', descZh: '官网报名申请', descEn: 'Website join applications', keys: 'join 报名 管理' },
    { group: 'admin', icon: '✦', href: 'chat-admin.html', requires: 'super', zh: 'Chat 管理', en: 'Chat admin', descZh: '供应商、模型与用量', descEn: 'Providers, models, usage', keys: 'chat 管理 模型' }
  ];

  var GROUPS = {
    learn: ['学习与资源', 'Learn'],
    play: ['AI 与游戏', 'Play'],
    member: ['社员空间', 'Member'],
    admin: ['管理后台', 'Admin']
  };

  // 权限状态：未就绪时一律按「访客」处理，管理入口默认不可见。
  var accessState = { ready: false, isSuperAdmin: false, permissions: {}, loggedIn: false };

  function staffAccess() {
    return global.ClubStaffAccess;
  }

  function canSee(item) {
    if (!item.requires) return true;
    if (!accessState.ready || !accessState.loggedIn) return false;
    if (accessState.isSuperAdmin) return true;
    if (item.requires === 'staff') {
      // 任一管理权限即可进入总览；没有权限的普通社员不显示。
      var perms = accessState.permissions || {};
      return Object.keys(perms).some(function (key) { return perms[key] === true; });
    }
    if (item.requires === 'super') return false;
    return (accessState.permissions || {})['can_' + item.requires] === true;
  }

  function visibleItemsFor(scope) {
    return ITEMS.filter(function (item) {
      if (scope && item.group !== scope) return false;
      return canSee(item);
    });
  }

  function syncAccess() {
    var api = staffAccess();
    if (!api || typeof api.getAccess !== 'function') {
      // 页面没有加载 member-identity：保持访客状态。
      accessState = { ready: false, isSuperAdmin: false, permissions: {}, loggedIn: false };
      return;
    }
    var access = api.getAccess() || {};
    accessState = {
      ready: typeof api.isReady === 'function' ? api.isReady() : false,
      isSuperAdmin: Boolean(access.isSuperAdmin),
      permissions: access.permissions || {},
      // 登录状态单独判断：空权限表也有 8 个键，不能拿来推断已登录。
      loggedIn: typeof api.isLoggedIn === 'function' ? Boolean(api.isLoggedIn()) : false
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function currentFile() {
    return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  }

  function hrefFor(item) {
    if (item.root) {
      // 次级页面统一位于 /public/，根目录首页是 ../index.html
      var base = inPublicDir() ? '../index.html' : './index.html';
      // 根目录条目可带锚点（如「实力」→ index.html#capabilities）
      var anchor = String(item.href || '').indexOf('#') >= 0 ? '#' + String(item.href).split('#')[1] : '';
      return base + anchor;
    }
    return (inPublicDir() ? '' : 'public/') + item.href;
  }

  function isHere(item) {
    if (item.root) return false;
    return currentFile() === item.href.split('?')[0].toLowerCase();
  }

  function matches(item, query) {
    if (!query) return true;
    var en = lang() === 'en';
    var haystack = [
      item.zh, item.en, item.descZh, item.descEn, item.keys,
      GROUPS[item.group] ? GROUPS[item.group].join(' ') : ''
    ].join(' ').toLowerCase();
    return haystack.indexOf(query) >= 0;
  }

  function readRecents() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(0, 6) : [];
    } catch (_error) {
      return [];
    }
  }

  function pushRecent(href) {
    try {
      var list = readRecents().filter(function (entry) { return entry !== href; });
      list.unshift(href);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 6)));
    } catch (_error) { /* storage unavailable */ }
  }

  /* ------------------------------------------------------------
     模块启动器
     ------------------------------------------------------------ */
  var launcher = null;
  var launcherInput = null;
  var launcherResults = null;
  var activeIndex = -1;
  var visibleItems = [];
  var lastTrigger = null;

  function buildLauncher() {
    if (launcher) return launcher;
    var en = lang() === 'en';
    launcher = document.createElement('div');
    launcher.className = 'club-launcher';
    launcher.setAttribute('role', 'dialog');
    launcher.setAttribute('aria-modal', 'true');
    launcher.setAttribute('aria-label', en ? 'Jump to a club module' : '跳转到社团模块');
    launcher.innerHTML =
      '<div class="club-launcher-panel" role="document">' +
        '<div class="club-launcher-search">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>' +
          '<input type="text" autocomplete="off" spellcheck="false" aria-controls="clubLauncherResults" ' +
            'placeholder="' + escapeHtml(en ? 'Search modules, labs, admin tools…' : '搜索功能、实验室、后台模块…') + '">' +
          '<kbd>ESC</kbd>' +
        '</div>' +
        '<div class="club-launcher-results" id="clubLauncherResults" role="listbox"></div>' +
        '<div class="club-launcher-foot">' +
          '<span>↑ ↓ ' + escapeHtml(en ? 'to move' : '选择') + ' · ↵ ' + escapeHtml(en ? 'to open' : '打开') + '</span>' +
          '<span>' + escapeHtml(en ? 'Ctrl / ⌘ + K' : 'Ctrl / ⌘ + K') + '</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(launcher);
    launcherInput = launcher.querySelector('input');
    launcherResults = launcher.querySelector('.club-launcher-results');

    launcher.addEventListener('mousedown', function (event) {
      if (event.target === launcher) closeLauncher();
    });
    launcherInput.addEventListener('input', function () { renderLauncher(launcherInput.value); });
    launcherInput.addEventListener('keydown', onLauncherKeydown);
    launcherResults.addEventListener('click', function (event) {
      var item = event.target.closest('.club-launcher-item');
      if (item) openLauncherItem(Number(item.dataset.index));
    });
    launcherResults.addEventListener('mousemove', function (event) {
      var item = event.target.closest('.club-launcher-item');
      if (!item) return;
      setActive(Number(item.dataset.index));
    });
    return launcher;
  }

  function renderLauncher(query) {
    var en = lang() === 'en';
    var needle = String(query || '').trim().toLowerCase();
    visibleItems = [];
    var html = '';
    var groups = ['learn', 'play', 'member', 'admin'];

    groups.forEach(function (group) {
      var hits = visibleItemsFor(group).filter(function (item) {
        return matches(item, needle);
      });
      if (!hits.length) return;
      html += '<div class="club-launcher-group">' + escapeHtml(GROUPS[group][en ? 1 : 0]) + '</div>';
      hits.forEach(function (item) {
        var index = visibleItems.length;
        visibleItems.push(item);
        html +=
          '<button type="button" class="club-launcher-item" role="option" data-index="' + index + '" aria-selected="false">' +
            '<span class="club-launcher-icon" aria-hidden="true">' + escapeHtml(item.icon) + '</span>' +
            '<span class="club-launcher-copy">' +
              '<strong>' + escapeHtml(en ? item.en : item.zh) + '</strong>' +
              '<small>' + escapeHtml(en ? item.descEn : item.descZh) + '</small>' +
            '</span>' +
          '</button>';
      });
    });

    if (!visibleItems.length) {
      html = '<div class="club-launcher-empty">' + escapeHtml(en ? 'No matching module.' : '没有匹配的模块。') + '</div>';
    }
    launcherResults.innerHTML = html;
    activeIndex = visibleItems.length ? 0 : -1;
    setActive(activeIndex);
  }

  function setActive(index) {
    var nodes = launcherResults.querySelectorAll('.club-launcher-item');
    nodes.forEach(function (node) {
      var on = Number(node.dataset.index) === index;
      node.classList.toggle('is-active', on);
      node.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    activeIndex = index;
    var active = launcherResults.querySelector('.club-launcher-item.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function onLauncherKeydown(event) {
    if (event.key === 'Escape') { closeLauncher(); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!visibleItems.length) return;
      setActive((activeIndex + 1) % visibleItems.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visibleItems.length) return;
      setActive((activeIndex - 1 + visibleItems.length) % visibleItems.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openLauncherItem(activeIndex);
    }
  }

  function openLauncherItem(index) {
    var item = visibleItems[index];
    if (!item) return;
    var href = hrefFor(item);
    pushRecent(href);
    closeLauncher();
    location.href = href;
  }

  function openLauncher() {
    buildLauncher();
    syncAccess();
    lastTrigger = document.activeElement;
    // 语言可能在打开前切换过，重建文案
    if (launcher.dataset.lang !== lang()) {
      launcher.dataset.lang = lang();
      var en = lang() === 'en';
      launcherInput.placeholder = en ? 'Search modules, labs, admin tools…' : '搜索功能、实验室、后台模块…';
      launcher.setAttribute('aria-label', en ? 'Jump to a club module' : '跳转到社团模块');
      var foot = launcher.querySelector('.club-launcher-foot');
      if (foot) {
        foot.innerHTML = '<span>↑ ↓ ' + escapeHtml(en ? 'to move' : '选择') + ' · ↵ ' + escapeHtml(en ? 'to open' : '打开') + '</span>' +
          '<span>Ctrl / ⌘ + K</span>';
      }
    }
    launcher.classList.add('is-open');
    launcherInput.value = '';
    renderLauncher('');
    document.body.classList.add('club-launcher-open');
    // 必须同步聚焦：异步 setTimeout 在后台标签页会被节流，键盘用户会停在 body。
    launcherInput.focus();
    try { launcherInput.setSelectionRange(0, 0); } catch (_error) { /* ignore */ }
  }

  function closeLauncher() {
    if (!launcher) return;
    var wasOpen = launcher.classList.contains('is-open');
    launcher.classList.remove('is-open');
    document.body.classList.remove('club-launcher-open');
    if (!wasOpen) return;
    var target = lastTrigger && document.contains(lastTrigger)
      ? lastTrigger
      : document.querySelector('.club-launcher-button');
    if (target) target.focus({ preventScroll: true });
  }

  function isLauncherOpen() {
    return Boolean(launcher && launcher.classList.contains('is-open'));
  }

  /* ------------------------------------------------------------
     通知铃铛
     ------------------------------------------------------------ */
  var NOTIFY_URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/club-drive';
  var NOTIFY_KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
  var notifyPanel = null;
  var notifyTimer = null;
  var notifyState = { items: [], unread: 0, loading: false, error: '' };

  function notifyText(key, fallback) { return t(key, fallback); }

  async function notifyCall(action, body) {
    var session = null;
    try {
      if (global.ClubStaffAccess && typeof global.ClubStaffAccess.getSession === 'function') {
        session = await global.ClubStaffAccess.getSession();
      }
    } catch (_error) { session = null; }
    if (!session || !session.access_token) return null;
    var response = await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: NOTIFY_KEY, authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify(Object.assign({ action: action }, body || {}))
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'notifications');
    return payload;
  }

  function notifyBadge(count) {
    var badge = document.querySelector('[data-club-notify-badge]');
    if (!badge) return;
    var n = Number(count) || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n <= 0;
  }

  function closeNotifyPanel() {
    if (notifyPanel) notifyPanel.classList.remove('is-open');
    var button = document.querySelector('[data-club-notify-button]');
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function renderNotifyPanel() {
    if (!notifyPanel) return;
    var en = lang() === 'en';
    var body = notifyPanel.querySelector('[data-club-notify-list]');
    if (!body) return;
    if (notifyState.loading && !notifyState.items.length) {
      body.innerHTML = '<p class="club-notify-empty">' + escapeHtml(en ? 'Loading...' : '正在读取通知...') + '</p>';
      return;
    }
    if (notifyState.error) {
      body.innerHTML = '<p class="club-notify-empty">' + escapeHtml(notifyState.error) + '</p>';
      return;
    }
    if (!notifyState.items.length) {
      body.innerHTML = '<p class="club-notify-empty">' + escapeHtml(en ? 'No notifications yet.' : '暂无通知。') + '</p>';
      return;
    }
    body.innerHTML = notifyState.items.map(function (item) {
      return '<a class="club-notify-item' + (item.read ? '' : ' is-unread') + '" href="' + escapeHtml(item.link || 'notifications.html') + '" data-notify-id="' + escapeHtml(item.id) + '">' +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        (item.body ? '<span>' + escapeHtml(item.body) + '</span>' : '') +
        '<time>' + escapeHtml(String(item.created_at || '').slice(0, 16).replace('T', ' ')) + '</time>' +
        '</a>';
    }).join('');
  }

  async function refreshNotifications() {
    if (!notifyPanel) return;
    var session = null;
    try {
      if (global.ClubStaffAccess && typeof global.ClubStaffAccess.getSession === 'function') session = await global.ClubStaffAccess.getSession();
    } catch (_error) { session = null; }
    if (!session) { notifyState = { items: [], unread: 0, loading: false, error: '' }; notifyBadge(0); return; }
    notifyState.loading = true;
    renderNotifyPanel();
    try {
      var payload = await notifyCall('notifications_list', { limit: 20 });
      if (!payload) { notifyState = { items: [], unread: 0, loading: false, error: '' }; notifyBadge(0); return; }
      notifyState = {
        items: Array.isArray(payload.notifications) ? payload.notifications : [],
        unread: Number(payload.unreadCount) || 0,
        loading: false,
        error: ''
      };
      notifyBadge(notifyState.unread);
    } catch (error) {
      notifyState.loading = false;
      notifyState.error = notifyText('notify.loadFailed', lang() === 'en' ? 'Could not load notifications.' : '读取通知失败。');
      notifyBadge(0);
    }
    renderNotifyPanel();
  }

  async function openNotifyPanel() {
    if (!notifyPanel) return;
    var isOpen = notifyPanel.classList.contains('is-open');
    if (isOpen) { closeNotifyPanel(); return; }
    notifyPanel.classList.add('is-open');
    var button = document.querySelector('[data-club-notify-button]');
    if (button) button.setAttribute('aria-expanded', 'true');
    await refreshNotifications();
  }

  function ensureNotifyPanel() {
    if (notifyPanel) return notifyPanel;
    notifyPanel = document.createElement('div');
    notifyPanel.className = 'club-notify-panel';
    notifyPanel.setAttribute('role', 'dialog');
    notifyPanel.setAttribute('aria-label', lang() === 'en' ? 'Notifications' : '通知');
    notifyPanel.innerHTML =
      '<div class="club-notify-head"><strong>' + escapeHtml(lang() === 'en' ? 'Notifications' : '通知') + '</strong>' +
      '<a href="notifications.html">' + escapeHtml(lang() === 'en' ? 'View all' : '查看全部') + '</a></div>' +
      '<div class="club-notify-list" data-club-notify-list></div>';
    document.body.appendChild(notifyPanel);
    document.addEventListener('click', function (event) {
      if (!notifyPanel || !notifyPanel.classList.contains('is-open')) return;
      if (notifyPanel.contains(event.target)) return;
      if (event.target.closest && event.target.closest('[data-club-notify-button]')) return;
      closeNotifyPanel();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeNotifyPanel();
    });
    return notifyPanel;
  }

  function mountNotifyButton() {
    if (document.querySelector('[data-club-notify-button]')) return;
    var staff = staffAccess();
    if (!staff || typeof staff.isLoggedIn !== 'function' || !staff.isLoggedIn()) return;
    var bar = document.querySelector('.topbar-inner') ||
      document.querySelector('.chat-admin-header-inner') ||
      document.querySelector('header.topbar') ||
      document.querySelector('header.page-header');
    if (!bar) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'club-notify-button';
    button.setAttribute('data-club-notify-button', '');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', lang() === 'en' ? 'Notifications' : '通知');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a5 5 0 0 0-5 5v3.2L5.6 15h12.8L17 11.2V8a5 5 0 0 0-5-5z"/><path d="M10 18a2 2 0 0 0 4 0"/></svg>' +
      '<span class="club-notify-badge" data-club-notify-badge hidden>0</span>';
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      openNotifyPanel();
    });
    ensureNotifyPanel();
    var actions = bar.querySelector('.topbar-actions') || bar.querySelector('.chat-admin-header-actions');
    if (actions) actions.insertBefore(button, actions.firstChild);
    else {
      var menu = bar.querySelector('#menuButton');
      if (menu) bar.insertBefore(button, menu); else bar.appendChild(button);
    }
    refreshNotifications();
    if (!notifyTimer) notifyTimer = setInterval(refreshNotifications, 120000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refreshNotifications();
    });
  }

  /* ------------------------------------------------------------
     顶栏
     ------------------------------------------------------------ */
  function mountLauncherButton() {
    var isClubPage = document.body.classList.contains('club-page');
    var bar = isClubPage
      ? (document.querySelector('.topbar-inner') ||
         document.querySelector('.club-topbar') ||
         document.querySelector('.chat-admin-header-inner'))
      : (document.querySelector('header.topbar') || document.querySelector('header.page-header'));
    if (!bar || bar.querySelector('.club-launcher-button')) return;

    var en = lang() === 'en';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'club-launcher-button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-label', en ? 'Jump to a module (Ctrl K)' : '跳转模块（Ctrl K）');
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>' +
      '<span>' + escapeHtml(en ? 'Jump to' : '跳转模块') + '</span>' +
      '<kbd>⌘K</kbd>';
    button.addEventListener('click', openLauncher);

    var actions = bar.querySelector('.topbar-actions') || bar.querySelector('.chat-admin-header-actions');
    if (actions) {
      actions.insertBefore(button, actions.firstChild);
      return;
    }
    // 实验室 / 游戏页：放在返回链接与身份胶囊之后、菜单按钮之前
    var menu = bar.querySelector('#menuButton');
    if (menu) {
      bar.insertBefore(button, menu);
      return;
    }
    var identity = bar.querySelector('.member-identity');
    if (identity && identity.nextSibling) {
      bar.insertBefore(button, identity.nextSibling);
      return;
    }
    bar.appendChild(button);
  }

  // 次级页顶栏补上「首页 / 实力」入口：实力直接回到首页能力矩阵。
  function mountSiteNav() {
    if (!document.body.classList.contains('club-page')) return;
    var bar = document.querySelector('body.club-page .topbar-inner') ||
      document.querySelector('body.club-page .chat-admin-header-inner');
    if (!bar || bar.querySelector('.club-site-nav')) return;
    var en = lang() === 'en';
    var nav = document.createElement('nav');
    nav.className = 'club-site-nav';
    nav.setAttribute('aria-label', en ? 'Site' : '站点导航');
    var links = [
      { href: '../index.html', zh: '首页', en: 'Home' },
      { href: '../index.html#capabilities', zh: '实力', en: 'Proof' }
    ];
    links.forEach(function (item) {
      var a = document.createElement('a');
      a.href = item.href;
      a.textContent = en ? item.en : item.zh;
      nav.appendChild(a);
    });
    // Chat 管理页有自己的头部结构：站点导航放进动作区，不插在品牌后面。
    var chatActions = bar.querySelector('.chat-admin-header-actions');
    if (chatActions) { chatActions.appendChild(nav); return; }
    var brand = bar.querySelector('.brand');
    if (brand && brand.nextSibling) bar.insertBefore(nav, brand.nextSibling);
    else bar.appendChild(nav);
  }

  function normalizeTopbar() {
    var bar = document.querySelector('body.club-page .topbar-inner');
    if (!bar) return;

    // 把顶栏右侧链接收进 .topbar-actions，保证顺序稳定
    var actions = bar.querySelector('.topbar-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'topbar-actions';
      var back = bar.querySelector('a.back');
      if (back) {
        back.parentNode.insertBefore(actions, back);
        actions.appendChild(back);
      } else {
        bar.appendChild(actions);
      }
    }
    bar.querySelectorAll(':scope > a.back').forEach(function (node) { actions.appendChild(node); });

    // 语言 / 主题切换器也收进同一行
    ['lang-switcher', 'theme-switcher'].forEach(function (cls) {
      bar.querySelectorAll(':scope > .' + cls).forEach(function (node) { actions.appendChild(node); });
    });

    // 顶部身份胶囊跟在动作组之前
    var identity = bar.querySelector('.member-identity, .identity');
    if (identity && identity.nextElementSibling !== actions) {
      actions.parentNode.insertBefore(identity, actions);
    }
  }

  // 次级页面原来没有语言切换器；这里补挂一个，保证每页都能中英切换。
  function mountLanguageSwitcher() {
    if (!document.body.classList.contains('club-page')) {
      mountUtilityGroup();
      return;
    }
    if (!global.ClubI18n || typeof global.ClubI18n.mountSwitcher !== 'function') return;
    var actions = document.querySelector('body.club-page .topbar-actions');
    if (!actions) {
      mountUtilityGroup();
      return;
    }

    if (!actions.querySelector('[data-lang-switcher]')) {
      // 直接挂到动作组里，让 theme.js 的 autoMount 能把主题切换器排到它后面。
      global.ClubI18n.mountSwitcher(actions);
    }
    global.ClubI18n.syncSwitcher(actions);

    // 让 theme.js 重新归位自己的切换器（它按「语言切换器之后」定位）。
    if (global.ClubTheme && typeof global.ClubTheme.autoMountSwitcher === 'function') {
      global.ClubTheme.autoMountSwitcher();
    }

    // 清理历史重复：同一动作组里只保留最后一个主题切换器。
    var themes = Array.prototype.slice.call(actions.querySelectorAll('[data-theme-switcher]'));
    themes.slice(0, -1).forEach(function (node) { node.remove(); });
  }

  // 实验室 / 游戏页沿用各自顶栏：把语言与主题切换器合并成一组，避免换行。
  function mountUtilityGroup() {
    var bar = document.querySelector('header.topbar') ||
      document.querySelector('header.page-header') ||
      document.querySelector('.chat-admin-header-inner');
    if (!bar) return;
    // 官网首页有自己的顶栏布局：#langSwitcherHost 已在导航内，主题切换器由
    // theme.js 紧跟其后挂载。这里不能再套绝对定位组，否则会挤成两行。
    if (!inPublicDir()) return;
    if (bar.querySelector('.club-topbar-utils')) {
      var existing = bar.querySelector('.club-topbar-utils');
      // 兼容上一版留下的绝对定位组：flex 顶栏里必须回到正常流。
      if (getComputedStyle(bar).display.indexOf('flex') >= 0) {
        existing.classList.add('club-topbar-utils-inline');
      } else {
        existing.classList.add('club-topbar-utils-float');
      }
      ensureSwitchers(existing);
      return;
    }
    var lang = bar.querySelector('[data-lang-switcher]');
    if (!lang) {
      // 这些页面历史上没有切换器：补一个紧凑组，避免用户只能回首页改语言/主题。
      if (!global.ClubI18n || typeof global.ClubI18n.mountSwitcher !== 'function') return;
      var group = document.createElement('div');
      group.className = 'club-topbar-utils';
      bar.classList.add('club-topbar-host');
      bar.appendChild(group);
      ensureSwitchers(group);
      return;
    }
    // 这些页面顶栏是 flex 布局：切换器必须作为正常流的一部分排在行尾，
    // 绝对定位会压住「返回官网 / 实验室选择」等链接。
    // 唯一例外是 block 布局的 page-header（gomoku / tetris / snake），
    // 那里没有行内右端可用，才使用右上角绝对定位。
    var theme = bar.querySelector('[data-theme-switcher]');
    var group = document.createElement('div');
    group.className = 'club-topbar-utils';
    // tetris / snake 的 .page-header 自身是 flex 行，但字面值可能被内联样式改写；
    // gomoku 的 header 是 block。按「是否为 .page-header 且不是已知 block 页」判定不稳，
    // 因此直接看它有没有行内可用的右端：只有 block 布局才用绝对定位。
    // 规则：顶栏本身是 flex → 切换器作为行内元素排在末尾；
    // 否则（gomoku 这类 block 页头）用绝对定位贴右上角，绝不压住标题与链接。
    var isFlexBar = getComputedStyle(bar).display.indexOf('flex') >= 0;
    if (!isFlexBar) bar.classList.add('club-topbar-host');
    else group.classList.add('club-topbar-utils-inline');
    // 语言切换器通常包在 #langSwitcherHost 里，必须插到它自己的父节点上。
    lang.parentNode.insertBefore(group, lang);
    group.appendChild(lang);
    if (theme) group.appendChild(theme);
    ensureSwitchers(group);
    if (isFlexBar) {
      // 插到顶栏末尾，保持在返回链接之后，不覆盖任何可点击元素。
      bar.appendChild(group);
    }
  }

  function ensureSwitchers(group) {
    if (!group) return;
    if (!group.querySelector('[data-lang-switcher]') && global.ClubI18n && global.ClubI18n.mountSwitcher) {
      global.ClubI18n.mountSwitcher(group);
    }
    if (!group.querySelector('[data-theme-switcher]') && global.ClubTheme && global.ClubTheme.mountSwitcher) {
      global.ClubTheme.mountSwitcher(group);
    }
    if (global.ClubI18n && global.ClubI18n.syncSwitcher) global.ClubI18n.syncSwitcher(group);
    if (global.ClubTheme && global.ClubTheme.refreshPickerUI) global.ClubTheme.refreshPickerUI();
  }

  /* ------------------------------------------------------------
     页内标签页
     ------------------------------------------------------------ */
  function setupTabs(scope) {
    (scope || document).querySelectorAll('[data-club-tabs]').forEach(function (tabs) {
      if (tabs.dataset.clubTabsReady) return;
      tabs.dataset.clubTabsReady = 'true';
      var filterMode = tabs.getAttribute('data-club-tabs') === 'filter';
      var buttons = Array.prototype.slice.call(tabs.querySelectorAll('[role="tab"], button[data-tab-target]'));
      if (!buttons.length) return;

      function groupOf(button) {
        return button.dataset.tabTarget || button.getAttribute('aria-controls') || '';
      }

      function applyFilter(group) {
        var scopeRoot = tabs.parentElement || document;
        scopeRoot.querySelectorAll('[data-club-group]').forEach(function (node) {
          node.classList.toggle('club-tab-hidden', group !== 'all' && node.dataset.clubGroup !== group);
        });
      }

      function activate(button, focus) {
        var group = groupOf(button);
        // 每次都遍历全部分组并显式写 hidden：
        // 外部逻辑（如权限刷新）可能把某些面板重新设为可见，
        // 只切换「上一个」会漏掉那些面板，导致多个工具同时铺在页面上。
        if (!filterMode) {
          buttons.forEach(function (btn) {
            var panel = document.getElementById(groupOf(btn));
            if (!panel) return;
            panel.hidden = groupOf(btn) !== group;
          });
        }
        tabs.dataset.activeTab = group;
        buttons.forEach(function (btn) {
          var on = btn === button;
          btn.setAttribute('aria-selected', on ? 'true' : 'false');
          btn.tabIndex = on ? 0 : -1;
        });
        if (filterMode) applyFilter(group);
        if (focus) button.focus();
        tabs.dispatchEvent(new CustomEvent('club:tabchange', {
          bubbles: true,
          detail: { target: group }
        }));
      }

      buttons.forEach(function (button, index) {
        if (!button.getAttribute('role')) button.setAttribute('role', 'tab');
        button.addEventListener('click', function () {
          if (tabs.dataset.activeTab === groupOf(button)) return;
          activate(button, false);
        });
        button.addEventListener('keydown', function (event) {
          var next = -1;
          if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
          if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = buttons.length - 1;
          if (next < 0) return;
          event.preventDefault();
          activate(buttons[next], true);
        });
      });

      // 给每个面板打标记：权限刷新等外部逻辑据此知道它由标签页托管，
      // 不再直接把「全部面板」设成可见。
      buttons.forEach(function (btn) {
        var panel = document.getElementById(groupOf(btn));
        if (panel) panel.setAttribute('data-club-tabpanel', '');
      });
      var initial = buttons.filter(function (btn) { return btn.getAttribute('aria-selected') === 'true'; })[0] || buttons[0];
      activate(initial, false);
    });
  }

  // 外部可在数据加载完成后指定当前标签
  function setTab(container, target) {
    if (!container) return false;
    var button = container.querySelector('[role="tab"][data-tab-target="' + target + '"], [role="tab"][aria-controls="' + target + '"]');
    if (!button) return false;
    button.click();
    return true;
  }

  /* ------------------------------------------------------------
     章节导航高亮
     ------------------------------------------------------------ */
  function setupSectionNav() {
    document.querySelectorAll('.club-section-nav').forEach(function (nav) {
      var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
      if (!links.length) return;
      var sections = links.map(function (link) {
        return document.getElementById(link.getAttribute('href').slice(1));
      }).filter(Boolean);
      if (!sections.length) return;

      function update() {
        var offset = 140;
        var current = sections[0];
        sections.forEach(function (section) {
          if (section.getBoundingClientRect().top - offset <= 0) current = section;
        });
        // 滚到底部时高亮最后一节
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
          current = sections[sections.length - 1];
        }
        links.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('href') === '#' + current.id);
        });
      }

      var frame = 0;
      window.addEventListener('scroll', function () {
        if (frame) return;
        frame = requestAnimationFrame(function () { frame = 0; update(); });
      }, { passive: true });
      window.addEventListener('resize', update, { passive: true });
      update();
    });
  }

  /* ------------------------------------------------------------
     回到顶部
     ------------------------------------------------------------ */
  function mountToTop() {
    if (document.querySelector('.club-to-top')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'club-to-top';
    button.setAttribute('aria-label', lang() === 'en' ? 'Back to top' : '回到顶部');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
    button.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(button);

    var frame = 0;
    function update() {
      frame = 0;
      button.classList.toggle('is-visible', window.scrollY > 480);
    }
    window.addEventListener('scroll', function () {
      if (frame) return;
      frame = requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* ------------------------------------------------------------
     键盘：
       Ctrl/⌘ + K  打开启动器
       /           聚焦页面主搜索框
       Esc         关闭启动器
     ------------------------------------------------------------ */
  function bindKeys() {
    document.addEventListener('keydown', function (event) {
      var meta = event.metaKey || event.ctrlKey;
      if (meta && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        if (isLauncherOpen()) closeLauncher();
        else openLauncher();
        return;
      }
      if (event.key === 'Escape' && isLauncherOpen()) {
        event.preventDefault();
        closeLauncher();
        return;
      }
      if (event.key === '/' && !isLauncherOpen()) {
        var target = event.target;
        var tag = (target && target.tagName) || '';
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (target && target.isContentEditable)) return;
        var search = document.querySelector('[data-club-search], #searchInput, input[type="search"]');
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
    });
  }

  /* ------------------------------------------------------------
     管理后台横向模块栏
     用法：<div class="club-admin-rail" data-club-admin-rail></div>
     ------------------------------------------------------------ */
  var ADMIN_RAIL = [
    { href: 'admin-hub.html', requires: 'staff', zh: '总览', en: 'Overview' },
    { href: 'members-admin.html', requires: 'members', zh: '成员', en: 'Showcase' },
    { href: 'events-admin.html', requires: 'events', zh: '活动公告', en: 'Events' },
    { href: 'mall-admin.html', requires: 'mall', zh: '商城', en: 'Mall' },
    { href: 'join-admin.html', requires: 'join', zh: '报名', en: 'Join' },
    { href: 'donations.html', requires: 'super', zh: '捐赠', en: 'Donations' },
    { href: 'chat-admin.html', requires: 'super', zh: 'Chat', en: 'Chat' }
  ];

  function mountAdminRail() {
    var host = document.querySelector('[data-club-admin-rail]');
    if (!host) return;
    syncAccess();
    var en = lang() === 'en';
    var current = currentFile();
    var inner = document.createElement('div');
    inner.className = 'club-admin-rail-inner';
    var label = document.createElement('span');
    label.className = 'club-admin-rail-label';
    label.textContent = en ? 'ADMIN' : '管理后台';
    inner.appendChild(label);
    var shown = 0;
    ADMIN_RAIL.forEach(function (item) {
      if (!canSee({ requires: item.requires })) return;
      shown += 1;
      var link = document.createElement('a');
      link.href = item.href;
      link.textContent = en ? item.en : item.zh;
      if (current === item.href) link.setAttribute('aria-current', 'page');
      inner.appendChild(link);
    });
    host.innerHTML = '';
    // 无任何管理权限时不渲染空导航条。
    host.hidden = shown === 0;
    if (shown === 0) return;
    host.appendChild(inner);
  }

  /* ------------------------------------------------------------
     启动
     ------------------------------------------------------------ */
  function refreshLocalizedChrome() {
    var button = document.querySelector('.club-launcher-button');
    if (button) {
      var en = lang() === 'en';
      var span = button.querySelector('span');
      if (span) span.textContent = en ? 'Jump to' : '跳转模块';
      button.setAttribute('aria-label', en ? 'Jump to a module (Ctrl K)' : '跳转模块（Ctrl K）');
    }
    var top = document.querySelector('.club-to-top');
    if (top) top.setAttribute('aria-label', lang() === 'en' ? 'Back to top' : '回到顶部');
  }

  // PWA：只在 http(s) 下注册（file:// 无法使用 Service Worker）。
  // 键盘用户跳过导航直达正文。
  function mountSkipLink() {
    if (document.querySelector('.club-skip-link')) return;
    var main = document.querySelector('main');
    if (!main) return;
    if (!main.id) main.id = 'club-main-content';
    var link = document.createElement('a');
    link.className = 'club-skip-link';
    link.href = '#' + main.id;
    link.textContent = lang() === 'en' ? 'Skip to content' : '跳到主内容';
    document.body.insertBefore(link, document.body.firstChild);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    if (document.querySelector('link[rel="manifest"]')) return;
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = new URL('manifest.webmanifest', scriptBase()).toString();
    document.head.appendChild(link);
    var theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#0b1220';
    document.head.appendChild(theme);
    navigator.serviceWorker.register(new URL('sw.js', scriptBase()).toString()).catch(function () { /* 注册失败不影响使用 */ });
  }

  function scriptBase() {
    var script = document.currentScript;
    if (script && script.src) return script.src.replace(/[^/]*$/, '');
    return new URL('./', location.href).toString();
  }

  function boot() {
    // 主页保留自己的 3D / 滚动样式；只有显式标记 body.club-page 的页面才套用共享外观。
    normalizeTopbar();
    mountSiteNav();
    mountLanguageSwitcher();
    mountSkipLink();
    mountLauncherButton();
    mountNotifyButton();
    registerServiceWorker();
    mountAdminRail();
    if (staffAccess() && typeof staffAccess().subscribe === 'function') {
      staffAccess().subscribe(function () {
        mountAdminRail();
        mountNotifyButton();
        // 启动器已创建时就地刷新列表与文案。
        if (launcher && launcher.classList.contains('is-open')) {
          renderLauncher(launcherInput ? launcherInput.value : '');
        }
      });
    }
    setupTabs(document);
    setupSectionNav();
    mountToTop();
    mountAssistantLauncher();
    bindKeys();
    // i18n / theme 的切换器注入时机晚于本脚本，补一次兜底归位。
    setTimeout(function () { mountLanguageSwitcher(); refreshLocalizedChrome(); mountNotifyButton(); }, 0);
    setTimeout(function () { mountLanguageSwitcher(); mountLauncherButton(); mountNotifyButton(); }, 220);
    window.addEventListener('club:langchange', function () {
      refreshLocalizedChrome();
      // 重建管理员栏的本地化文本
      var host = document.querySelector('[data-club-admin-rail]');
      if (host) { host.innerHTML = ''; mountAdminRail(); }
      var siteNav = document.querySelector('.club-site-nav');
      if (siteNav) siteNav.remove();
      mountSiteNav();
      mountLanguageSwitcher();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  global.ClubShell = {
    items: ITEMS,
    openLauncher: openLauncher,
    closeLauncher: closeLauncher,
    setupTabs: setupTabs,
    setTab: setTab,
    mountAdminRail: mountAdminRail
  };
})(window);
