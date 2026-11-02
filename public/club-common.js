/**
 * 全站共享前端基础层。
 * 自包含（样式运行时注入），不依赖 club-ui.css，因此 chat / assistant /
 * platformer 这类独立页面也能使用。
 *
 * 提供：escapeHtml、统一确认对话框、5 秒可撤销删除、列表三态、401 会话提示。
 * 加载方式：普通 <script>，需位于各页内联脚本与 chat.js 之前。
 */
(function (global) {
  'use strict';

  if (global.ClubCommon) return;

  var STYLE_ID = 'club-common-style';
  var DIALOG_CLASS = 'club-common-dialog-layer';
  var UNDO_HOST_ID = 'club-common-undo-host';

  // 内置兜底：即使 ClubI18n 尚未 boot（脚本顺序 / 词典延迟），
  // 共享层的按钮也不能显示 common.confirm 这种原始 key。
  var FALLBACK_TEXT = {
    'common.confirm': { zh: '确定', en: 'Confirm' },
    'common.cancel': { zh: '取消', en: 'Cancel' },
    'common.delete': { zh: '删除', en: 'Delete' },
    'common.undo': { zh: '撤销', en: 'Undo' },
    'common.retry': { zh: '重试', en: 'Retry' },
    'common.dismiss': { zh: '关闭', en: 'Dismiss' },
    'common.pendingDelete': { zh: '已删除，5 秒内可撤销。', en: 'Deleted. Undo within 5 seconds.' },
    'common.undoRegion': { zh: '待撤销操作', en: 'Pending undo' },
    'common.loadFailed': { zh: '读取失败', en: 'Could not load' },
    'common.loadRetry': { zh: '请检查网络后重试。', en: 'Check your connection and try again.' },
    'common.requestFailed': { zh: '请求失败，请稍后重试。', en: 'Request failed. Please try again.' },
    'common.sessionExpired': { zh: '登录已过期，请重新登录后再试。', en: 'Your session expired. Please sign in again.' },
    'common.sessionExpiredAction': { zh: '前往个人中心登录', en: 'Go to Member Center' }
  };

  function currentLang() {
    try {
      if (global.ClubI18n && typeof global.ClubI18n.getLang === 'function') return global.ClubI18n.getLang();
    } catch (_error) { /* ignore */ }
    try { return (localStorage.getItem('algorithm-club-lang') || 'zh').startsWith('en') ? 'en' : 'zh'; }
    catch (_error) { return 'zh'; }
  }

  // 直接从词典对象取值：ClubI18n 未 boot 时也能命中。
  function lookupDict(key, lang) {
    var dict = global.ClubI18nDict;
    if (!dict || !dict[lang]) return '';
    var node = dict[lang];
    var parts = String(key).split('.');
    for (var i = 0; i < parts.length; i += 1) {
      if (!node || typeof node !== 'object') return '';
      node = node[parts[i]];
    }
    return typeof node === 'string' ? node : '';
  }

  function t(key, vars) {
    var lang = currentLang();
    var value = '';
    try {
      if (global.ClubI18n && typeof global.ClubI18n.t === 'function') {
        var resolved = global.ClubI18n.t(key, vars);
        if (resolved && resolved !== key) value = resolved;
      }
    } catch (_error) { /* ignore */ }
    if (!value) value = lookupDict(key, lang) || lookupDict(key, 'zh');
    if (!value && FALLBACK_TEXT[key]) value = FALLBACK_TEXT[key][lang] || FALLBACK_TEXT[key].zh;
    if (!value) return key;
    if (vars && typeof value === 'string') {
      value = value.replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
      });
    }
    return value;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Local aliases keep standalone pages legible without redefining site tokens. */
      .club-common-dialog-layer,.club-common-undo,.club-common-state,.club-common-skeleton,.club-common-session,.club-common-toast{
        --club-runtime-panel:var(--club-metal-panel,#1c2530);
        --club-runtime-read:var(--club-material-read,var(--club-surface,#191f26));
        --club-runtime-control:var(--club-material-control,#242f3c);
        --club-runtime-hover:var(--club-material-hover,#2c3a49);
        --club-runtime-control-finish:var(--club-metal-control-finish,linear-gradient(180deg,rgba(221,237,250,.10),rgba(221,237,250,.015) 52%,rgba(4,12,24,.12)));
        --club-runtime-control-rim:rgba(221,237,250,.16);
        --club-runtime-control-shadow:inset 0 1px 0 var(--club-runtime-control-rim),0 2px 3px rgba(0,7,18,.12);
        --club-runtime-text:var(--club-text,#edf0f2);
        --club-runtime-muted:var(--club-muted,#a0a9b2);
        --club-runtime-line:var(--club-line,rgba(180,190,200,.16));
        --club-runtime-edge:var(--club-line-strong,rgba(180,190,200,.32));
        --club-runtime-accent:var(--club-accent,#3ad4e6);
        --club-runtime-soft:var(--club-accent-soft,rgba(58,212,230,.12));
        --club-runtime-danger:var(--club-danger,#ff8095);
        --club-runtime-danger-soft:var(--club-danger-soft,#39232b);
        --club-runtime-shadow:var(--club-material-shadow,0 16px 48px rgba(0,0,0,.32));
        font-family:var(--club-font,"Inter Variable","MiSans VF","MiSans","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",system-ui,sans-serif);
        box-sizing:border-box;color:var(--club-runtime-text);color-scheme:dark;
      }
      html[data-theme="light"] :is(.club-common-dialog-layer,.club-common-undo,.club-common-state,.club-common-skeleton,.club-common-session,.club-common-toast){
        --club-runtime-panel:var(--club-metal-panel,#f1eee8);
        --club-runtime-read:var(--club-material-read,var(--club-surface,#fffdfa));
        --club-runtime-control:var(--club-material-control,#f7f4ee);--club-runtime-hover:var(--club-material-hover,#fffdf8);
        --club-runtime-control-finish:var(--club-metal-control-finish,linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,.08) 52%,rgba(108,93,74,.05)));
        --club-runtime-control-rim:rgba(255,255,255,.92);
        --club-runtime-control-shadow:inset 0 1px 0 var(--club-runtime-control-rim),0 2px 3px rgba(71,57,39,.07);
        --club-runtime-text:var(--club-text,#17181c);--club-runtime-muted:var(--club-muted,#5b6069);
        --club-runtime-line:var(--club-line,#e2e5eb);--club-runtime-edge:var(--club-line-strong,#cdd2db);
        --club-runtime-accent:var(--club-accent,#c2410c);--club-runtime-soft:var(--club-accent-soft,#fdf0ea);
        --club-runtime-danger:var(--club-danger,#b4233b);--club-runtime-danger-soft:var(--club-danger-soft,#fdeef1);
        --club-runtime-shadow:var(--club-material-shadow,0 16px 48px rgba(23,24,28,.12));color-scheme:light;
      }
      .club-common-dialog-layer{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:var(--club-material-scrim,rgba(8,10,12,.64));animation:common-fade-in .16s cubic-bezier(.22,1,.36,1)}
      html[data-theme="light"] .club-common-dialog-layer{background:var(--club-material-scrim,rgba(32,38,48,.28))}
      .club-common-dialog{box-sizing:border-box;width:min(460px,100%);max-height:min(80vh,640px);overflow:auto;padding:28px 28px 20px;border:1px solid var(--club-runtime-edge);border-radius:var(--club-radius,14px);background:var(--club-runtime-panel);color:var(--club-runtime-text);box-shadow:var(--club-runtime-shadow);scrollbar-width:thin;scrollbar-color:var(--club-runtime-edge) var(--club-runtime-panel);animation:common-pop-in .18s cubic-bezier(.22,1,.36,1)}
      @keyframes common-pop-in{from{opacity:0;transform:translateY(6px) scale(.99)}}
      @keyframes common-fade-in{from{opacity:0}}
      @keyframes common-undo-in{from{opacity:0;transform:translateY(8px)}}
      .club-common-dialog h2{margin:0 0 16px;font-size:21px;font-weight:740;line-height:1.3;color:var(--club-runtime-text);text-wrap:balance;overflow-wrap:anywhere}
      .club-common-dialog p{margin:0 0 20px;padding:16px 0;border-block:1px solid var(--club-runtime-line);background:var(--club-runtime-read);color:var(--club-runtime-muted);font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
      .club-common-dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
      .club-common-dialog-actions button,.club-common-undo button,.club-common-state button,.club-common-session button{box-sizing:border-box;min-height:40px;padding:8px 16px;border-radius:var(--club-radius-sm,9px);border:1px solid var(--club-runtime-edge);background-color:var(--club-runtime-control);background-image:var(--club-runtime-control-finish);box-shadow:var(--club-runtime-control-shadow);-webkit-backdrop-filter:none;backdrop-filter:none;color:var(--club-runtime-text);font:inherit;font-size:13px;font-weight:650;line-height:1.4;cursor:pointer;transition:background-color .14s cubic-bezier(.22,1,.36,1),border-color .14s cubic-bezier(.22,1,.36,1),transform .14s cubic-bezier(.22,1,.36,1)}
      .club-common-dialog-actions button:hover,.club-common-state button:hover,.club-common-session button:hover{background-color:var(--club-runtime-hover);border-color:var(--club-runtime-accent)}
      .club-common-dialog-actions button:active,.club-common-undo button:active,.club-common-state button:active,.club-common-session button:active{transform:translateY(1px)}
      .club-common-dialog-actions button:last-child:not(.club-common-danger){border-color:var(--club-runtime-accent);background-color:var(--club-runtime-soft);color:var(--club-runtime-accent);font-weight:700}
      .club-common-dialog-actions button.club-common-danger{border-color:var(--club-runtime-danger);background-color:var(--club-runtime-danger-soft);color:var(--club-runtime-danger)}
      .club-common-dialog-actions button.club-common-danger:hover{border-color:var(--club-runtime-danger);box-shadow:inset 0 0 0 1px var(--club-runtime-danger)}
      :is(.club-common-dialog-actions,.club-common-undo,.club-common-state,.club-common-session,.club-common-toast) :is(button,a):focus-visible{outline:2px solid var(--club-runtime-accent);outline-offset:3px}
      :is(.club-common-dialog-actions,.club-common-undo,.club-common-state,.club-common-session) button:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
      #club-common-undo-host{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:10050;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 36px));pointer-events:none}
      .club-common-undo{pointer-events:auto;display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid var(--club-runtime-edge);border-radius:12px;background:var(--club-runtime-panel);box-shadow:var(--club-runtime-shadow);font-size:13px;line-height:1.6;overflow:hidden;position:relative;animation:common-undo-in .18s cubic-bezier(.22,1,.36,1)}
      .club-common-undo-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
      .club-common-undo button{flex:0 0 auto;min-height:36px;padding:6px 12px;border-color:var(--club-runtime-accent);background-color:var(--club-runtime-soft);color:var(--club-runtime-accent)}
      .club-common-undo button:hover{background-color:var(--club-runtime-control);box-shadow:inset 0 0 0 1px var(--club-runtime-accent)}
      .club-common-undo-bar{position:absolute;left:0;bottom:0;height:2px;width:100%;background:var(--club-runtime-accent);transform-origin:left center;animation:club-common-countdown linear forwards}
      @keyframes club-common-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}
      .club-common-state{display:block;padding:28px 20px;border-block:1px solid var(--club-runtime-line);background:var(--club-runtime-read);text-align:center;color:var(--club-runtime-muted);font-size:14px;line-height:1.7;overflow-wrap:anywhere}
      .club-common-state strong{display:block;margin-bottom:8px;color:var(--club-runtime-text);font-size:15px;font-weight:650}
      .club-common-state.club-common-error strong{color:var(--club-runtime-danger)}
      .club-common-state button{display:block;margin:16px auto 0}
      .club-common-skeleton{display:grid;gap:10px;padding:20px}
      .club-common-skeleton span{display:block;height:14px;border:1px solid var(--club-runtime-line);border-radius:var(--club-radius-xs,6px);background-color:var(--club-runtime-control);background-image:var(--club-runtime-control-finish)}
      .club-common-skeleton span:nth-child(2){width:82%}.club-common-skeleton span:nth-child(3){width:64%}
      .club-common-session{position:fixed;top:0;left:0;right:0;z-index:10060;display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;padding:12px 20px;border-bottom:1px solid var(--club-runtime-edge);background:var(--club-runtime-panel);font-size:13px;line-height:1.6;box-shadow:inset 0 1px 0 var(--club-runtime-control-rim),0 4px 16px rgba(0,0,0,.12)}
      .club-common-session span{overflow-wrap:anywhere}.club-common-session a{color:var(--club-runtime-accent);font-weight:650;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
      .club-common-session a:hover{color:var(--club-runtime-text)}.club-common-session button{margin-left:auto;min-height:36px;padding:6px 12px}
      .club-common-toast-host{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:10040;display:flex;flex-direction:column;gap:10px;width:min(360px,calc(100vw - 36px));pointer-events:none}
      body:has(#club-common-undo-host:not(:empty)) .club-common-toast-host{bottom:calc(96px + env(safe-area-inset-bottom,0px))}
      .club-common-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;padding:14px 12px 14px 16px;border:1px solid var(--club-runtime-edge);border-radius:12px;background:var(--club-runtime-panel);box-shadow:var(--club-runtime-shadow);font-size:13px;line-height:1.6;opacity:0;transform:translateY(8px);transition:opacity .2s cubic-bezier(.22,1,.36,1),transform .2s cubic-bezier(.22,1,.36,1)}
      /* Floating chrome only: no scrim blur, pseudo-overlay, or pointer listener here.
         The shared lighting owner may tag these known selectors independently. */
      :is(.club-common-dialog,.club-common-undo,.club-common-toast){
        --club-pointer-active:0;
        --club-runtime-glass-fill:var(--club-liquid-fallback,#162231);
        --club-runtime-glass-tint:var(--club-liquid-glass,rgba(18,29,44,.78));
        --club-runtime-light-rgb:190,226,255;
        --club-runtime-gloss:var(--club-liquid-wash,linear-gradient(155deg,rgba(211,235,255,.12),rgba(211,235,255,0) 42%,rgba(58,212,230,.025)));
        --club-runtime-rim:var(--club-liquid-rim,rgba(224,243,255,.27));
        --club-runtime-rim-low:var(--club-liquid-rim-low,rgba(8,17,29,.52));
        border-color:var(--club-liquid-line,rgba(151,192,218,.28));border-radius:20px;
        background-color:var(--club-runtime-glass-fill);
        background-image:radial-gradient(240px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-runtime-light-rgb),calc(var(--club-pointer-active,0)*.075)),transparent 72%),var(--club-runtime-gloss);
        box-shadow:inset 0 1px 0 var(--club-runtime-rim),inset 0 -1px 0 var(--club-runtime-rim-low),var(--club-runtime-shadow);
      }
      html[data-theme="light"] :is(.club-common-dialog,.club-common-undo,.club-common-toast){
        --club-runtime-glass-fill:var(--club-liquid-fallback,#faf7f2);
        --club-runtime-glass-tint:var(--club-liquid-glass,rgba(255,252,247,.88));
        --club-runtime-light-rgb:194,133,76;
        --club-runtime-gloss:var(--club-liquid-wash,linear-gradient(155deg,rgba(255,255,255,.8),rgba(255,255,255,0) 44%,rgba(194,133,76,.035)));
        --club-runtime-rim:var(--club-liquid-rim,rgba(255,255,255,.9));
        --club-runtime-rim-low:var(--club-liquid-rim-low,rgba(108,93,74,.12));
        border-color:var(--club-liquid-line,rgba(108,93,74,.24));
      }
      @supports (backdrop-filter:blur(12px)) or (-webkit-backdrop-filter:blur(12px)){
        :is(.club-common-dialog,.club-common-undo,.club-common-toast){background-color:var(--club-runtime-glass-tint);-webkit-backdrop-filter:blur(12px) saturate(1.2);backdrop-filter:blur(12px) saturate(1.2)}
        .club-common-dialog{-webkit-backdrop-filter:blur(16px) saturate(1.2);backdrop-filter:blur(16px) saturate(1.2)}
      }
      :is(.club-common-dialog-actions,.club-common-undo) button{
        --club-pointer-active:0;
        background-image:radial-gradient(120px circle at var(--club-pointer-x,50%) var(--club-pointer-y,50%),rgba(var(--club-runtime-light-rgb),calc(var(--club-pointer-active,0)*.04)),transparent 72%),var(--club-runtime-control-finish);
      }
      .club-common-dialog :is(input,select,textarea,pre,code){background:var(--club-runtime-read);-webkit-backdrop-filter:none;backdrop-filter:none}
      @media (prefers-reduced-transparency:reduce){
        :is(.club-common-dialog,.club-common-undo,.club-common-toast){background:var(--club-runtime-glass-fill)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
        :is(.club-common-dialog-actions,.club-common-undo) button{background-image:none!important}
      }
      @media (prefers-reduced-motion:reduce){:is(.club-common-dialog,.club-common-undo,.club-common-toast),:is(.club-common-dialog-actions,.club-common-undo) button{background-image:none!important}}
      @media (forced-colors:active){
        .club-common-dialog-layer{background:Canvas!important}
        :is(.club-common-dialog,.club-common-undo,.club-common-toast,.club-common-session,.club-common-state){background:Canvas!important;color:CanvasText!important;border-color:CanvasText!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
        :is(.club-common-dialog-actions,.club-common-undo,.club-common-toast,.club-common-session,.club-common-state) button{background:ButtonFace!important;color:ButtonText!important;border-color:ButtonText!important;box-shadow:none!important}
        :is(.club-common-dialog,.club-common-session,.club-common-state) :is(h2,p,strong){color:CanvasText!important}.club-common-session a{color:LinkText!important}
        :is(.club-common-dialog-actions,.club-common-undo,.club-common-toast,.club-common-session,.club-common-state) :is(button,a):focus-visible{outline-color:Highlight!important}
        .club-common-toast::before,.club-common-undo-bar{background:Highlight!important}
      }
      .club-common-toast.club-common-toast-in{opacity:1;transform:none}.club-common-toast.club-common-toast-out{opacity:0;transform:translateY(6px)}
      .club-common-toast::before{content:"";flex:0 0 auto;width:6px;height:6px;margin-top:7px;border-radius:50%;background:var(--club-info,#8fb4ff)}
      .club-common-toast.club-common-ok::before{background:var(--club-ok,#56d9a0)}.club-common-toast.club-common-error::before{background:var(--club-runtime-danger)}.club-common-toast.club-common-warn::before{background:var(--club-warn,#f2c66d)}
      .club-common-toast span{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
      .club-common-toast button{flex:0 0 auto;display:grid;place-items:center;min-width:32px;min-height:32px;margin:-4px 0;padding:4px;border:1px solid var(--club-runtime-line);border-radius:var(--club-radius-sm,9px);background-color:var(--club-runtime-control);background-image:var(--club-runtime-control-finish);box-shadow:inset 0 1px 0 var(--club-runtime-control-rim);color:var(--club-runtime-muted);font:inherit;font-size:18px;line-height:1;cursor:pointer;transition:background-color .14s ease,color .14s ease,transform .14s ease}
      .club-common-toast button:hover{background-color:var(--club-runtime-hover);border-color:var(--club-runtime-edge);color:var(--club-runtime-text)}.club-common-toast button:active{transform:translateY(1px)}
      :is(.club-common-dialog,.club-common-undo,.club-common-state,.club-common-session,.club-common-toast)::selection,:is(.club-common-dialog,.club-common-undo,.club-common-state,.club-common-session,.club-common-toast) ::selection{background:var(--club-runtime-soft);color:var(--club-runtime-text)}
      @media (max-width:640px){.club-common-dialog-layer{padding:16px}.club-common-dialog{padding:24px 20px 16px}.club-common-dialog-actions button{flex:1 1 auto}#club-common-undo-host{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));max-width:none}.club-common-undo{padding:12px}.club-common-toast-host{right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px))}}
      @media (pointer:coarse){:is(.club-common-dialog-actions,.club-common-undo,.club-common-state,.club-common-session,.club-common-toast) button{min-width:44px;min-height:44px}.club-common-session a{display:inline-flex;align-items:center;min-height:44px}}
      @media (prefers-reduced-motion:reduce){.club-common-dialog-layer,.club-common-dialog,.club-common-undo,.club-common-skeleton span,.club-common-undo-bar{animation:none!important}.club-common-toast,.club-common-toast.club-common-toast-in,.club-common-toast.club-common-toast-out{transform:none!important}:is(.club-common-dialog-layer,.club-common-undo,.club-common-state,.club-common-session,.club-common-toast),:is(.club-common-dialog-layer,.club-common-undo,.club-common-state,.club-common-session,.club-common-toast) *{transition:none!important;scroll-behavior:auto!important}.club-common-undo-bar{display:none}:is(.club-common-dialog-actions,.club-common-undo,.club-common-state,.club-common-session,.club-common-toast) button:active{transform:none!important}}
      @media print{.club-common-dialog-layer,#club-common-undo-host,.club-common-session,.club-common-toast-host{display:none!important}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /* ---------- 统一确认对话框 ---------- */
  var activeDialog = null;

  // 出场动效统一走 WAAPI：真实浏览器播完再移除节点；
  // 桩环境/旧浏览器没有 element.animate，立即回调保持同步移除语义。
  // （reduced-motion 由调用方先判；这里兜底 CSS 全局规则覆盖不到 WAAPI 的情况。）
  function animateOut(node, frames, options, onDone) {
    var reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_error) { reduced = false; }
    if (reduced || !node || typeof node.animate !== 'function') { onDone(); return; }
    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      onDone();
    };
    try {
      var animation = node.animate(frames, options);
      animation.addEventListener('finish', finish);
      animation.addEventListener('cancel', finish);
      // 兜底：finish 事件异常时不至于永远不移除。
      setTimeout(finish, (options && options.duration ? options.duration : 150) + 120);
    } catch (_error) {
      finish();
    }
  }

  function confirm(options) {
    var opts = options || {};
    if (typeof opts === 'string') opts = { message: opts };
    injectStyle();
    return new Promise(function (resolve) {
      // 同一时间只保留一个确认框；新请求会先取消旧的。
      if (activeDialog) activeDialog.dismiss(false);

      var previousFocus = document.activeElement;
      var layer = document.createElement('div');
      layer.className = DIALOG_CLASS;

      var dialog = document.createElement('div');
      dialog.className = 'club-common-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      var titleId = 'club-common-dialog-title-' + Math.random().toString(36).slice(2, 8);
      if (opts.title) {
        var heading = document.createElement('h2');
        heading.id = titleId;
        heading.textContent = opts.title;
        dialog.setAttribute('aria-labelledby', titleId);
        dialog.appendChild(heading);
      }

      var body = document.createElement('p');
      body.textContent = opts.message == null ? '' : String(opts.message);
      dialog.appendChild(body);

      var actions = document.createElement('div');
      actions.className = 'club-common-dialog-actions';
      var cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = opts.cancelText || t('common.cancel');
      var confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.textContent = opts.confirmText || t('common.confirm');
      if (opts.danger) confirmButton.className = 'club-common-danger';
      actions.append(cancelButton, confirmButton);
      dialog.appendChild(actions);
      layer.appendChild(dialog);

      var settled = false;
      function dismiss(result) {
        if (settled) return;
        settled = true;
        if (activeDialog && activeDialog.layer === layer) activeDialog = null;
        document.removeEventListener('keydown', onKeydown, true);
        // 出场：遮罩淡出 + 面板反向弹出，播完再真正移除；
        // 桩环境（无 WAAPI）立即移除，保持「dismiss 后节点已不在 DOM」的既有契约。
        layer.style.pointerEvents = 'none';
        animateOut(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'cubic-bezier(.22,1,.36,1)' }, function () {
          // remove() 在部分旧环境不存在；回退到父节点移除，保证对话框真的消失。
          if (typeof layer.remove === 'function') layer.remove();
          else if (layer.parentNode) layer.parentNode.removeChild(layer);
        });
        try {
          if (typeof dialog.animate === 'function' && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
            dialog.animate(
              [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(.99)' }],
              { duration: 150, easing: 'cubic-bezier(.22,1,.36,1)' }
            );
          }
        } catch (_error) { /* 动效失败不影响流程 */ }
        try { if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus(); } catch (_error) { /* ignore */ }
        resolve(result);
      }
      function onKeydown(event) {
        if (event.key === 'Escape') { event.preventDefault(); dismiss(false); return; }
        if (event.key !== 'Tab') return;
        // 把焦点圈在对话框的两个按钮内。
        var focusables = [cancelButton, confirmButton].filter(function (node) { return !node.disabled; });
        if (!focusables.length) return;
        var index = focusables.indexOf(document.activeElement);
        event.preventDefault();
        var next = event.shiftKey ? (index <= 0 ? focusables.length - 1 : index - 1) : (index >= focusables.length - 1 ? 0 : index + 1);
        focusables[next].focus();
      }

      activeDialog = { layer: layer, dismiss: dismiss };
      cancelButton.addEventListener('click', function () { dismiss(false); });
      confirmButton.addEventListener('click', function () { dismiss(true); });
      layer.addEventListener('mousedown', function (event) { if (event.target === layer) dismiss(false); });
      document.addEventListener('keydown', onKeydown, true);
      document.body.appendChild(layer);
      // 破坏性操作默认聚焦“取消”，避免误触回车直接删除。
      (opts.danger ? cancelButton : confirmButton).focus();
    });
  }

  /* ---------- 5 秒可撤销删除 ---------- */
  var undoHost = null;
  var pendingCommits = new Set();

  function ensureUndoHost() {
    if (undoHost && undoHost.isConnected) return undoHost;
    undoHost = document.getElementById(UNDO_HOST_ID);
    if (!undoHost) {
      undoHost = document.createElement('div');
      undoHost.id = UNDO_HOST_ID;
      undoHost.setAttribute('role', 'region');
      undoHost.setAttribute('aria-label', t('common.undoRegion'));
      (document.body || document.documentElement).appendChild(undoHost);
    }
    return undoHost;
  }

  function scheduleUndo(options) {
    var opts = options || {};
    var seconds = Number(opts.seconds) > 0 ? Number(opts.seconds) : 5;
    injectStyle();
    var host = ensureUndoHost();

    var item = document.createElement('div');
    item.className = 'club-common-undo';
    var text = document.createElement('span');
    text.className = 'club-common-undo-text';
    text.textContent = opts.message || t('common.pendingDelete');
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = opts.undoLabel || t('common.undo');
    var bar = document.createElement('span');
    bar.className = 'club-common-undo-bar';
    bar.style.animationDuration = seconds + 's';
    item.append(text, button, bar);
    host.appendChild(item);

    var done = false;
    var timer = null;
    var entry = { flush: flush };
    pendingCommits.add(entry);

    function removeItem(immediate) {
      pendingCommits.delete(entry);
      window.removeEventListener('pagehide', onPageHide);
      if (immediate) { item.remove(); return; }
      // 出场滑出后再移除；桩环境/减少动效由 animateOut 立即回调。
      item.style.pointerEvents = 'none';
      animateOut(item,
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px)' }],
        { duration: 150, easing: 'cubic-bezier(.22,1,.36,1)' },
        function () { item.remove(); });
    }
    function finish(commitNow) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // 先执行回调再移除节点：撤销回调可能需要把行插回列表。
      if (commitNow) {
        try {
          var result = opts.commit && opts.commit({ pagehide: false });
          if (result && typeof result.catch === 'function') result.catch(function () { /* 由调用方提示 */ });
        } catch (_error) { /* ignore */ }
      } else {
        try { var undo = opts.onUndo || opts.undo; if (undo) undo(); } catch (_error) { /* ignore */ }
      }
      removeItem();
    }
    function flush() {
      // 页面即将关闭：立即提交，调用方的 commit 应使用 keepalive fetch。
      if (done) return;
      done = true;
      clearTimeout(timer);
      removeItem(true); // pagehide 不播出场动效
      try { if (opts.commit) opts.commit({ pagehide: true }); } catch (_error) { /* ignore */ }
    }
    function onPageHide() { flush(); }

    button.addEventListener('click', function () { finish(false); });
    window.addEventListener('pagehide', onPageHide, { once: true });
    timer = setTimeout(function () { finish(true); }, seconds * 1000);

    return {
      cancel: function () { finish(false); },
      flush: function () { finish(true); },
      element: item
    };
  }

  /* ---------- 列表三态 ---------- */
  function listStateHtml(kind, options) {
    var opts = options || {};
    var message = opts.message == null ? '' : String(opts.message);
    if (kind === 'loading') {
      return '<div class="club-common-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>' +
        '<span class="club-common-state" role="status">' + escapeHtml(message || t('common.loading')) + '</span>';
    }
    if (kind === 'error') {
      return '<div class="club-common-state club-common-error" role="alert"><strong>' +
        escapeHtml(opts.title || t('common.loadFailed')) + '</strong>' +
        escapeHtml(message || t('common.loadRetry')) + '</div>';
    }
    return '<div class="club-common-state club-common-empty" role="status"><strong>' +
      escapeHtml(opts.title || t('common.empty')) + '</strong>' +
      (message ? escapeHtml(message) : '') + '</div>';
  }

  function listState(container, options) {
    if (!container) return;
    var opts = options || {};
    container.innerHTML = listStateHtml(opts.kind || 'loading', opts);
    if (opts.kind === 'loading') container.setAttribute('aria-busy', 'true');
    else container.removeAttribute('aria-busy');
    if (opts.kind === 'error' && typeof opts.onRetry === 'function') {
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'button secondary';
      retry.textContent = opts.retryLabel || t('common.retry');
      retry.addEventListener('click', opts.onRetry);
      var state = container.querySelector('.club-common-state');
      if (state) state.appendChild(retry);
    }
    return container;
  }

  /* ---------- 401 会话过期 ---------- */
  var sessionBanner = null;

  function memberCenterHref() {
    var path = String(location.pathname || '');
    return path.indexOf('/public/') >= 0 ? 'member-center.html' : 'public/member-center.html';
  }

  function showSessionBanner() {
    if (sessionBanner && sessionBanner.isConnected) return;
    injectStyle();
    sessionBanner = document.createElement('div');
    sessionBanner.className = 'club-common-session';
    sessionBanner.setAttribute('role', 'alert');
    var text = document.createElement('span');
    text.textContent = t('common.sessionExpired');
    var link = document.createElement('a');
    link.href = memberCenterHref();
    link.textContent = t('common.sessionExpiredAction');
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = t('common.dismiss');
    close.addEventListener('click', function () { sessionBanner.remove(); sessionBanner = null; });
    sessionBanner.append(text, link, close);
    (document.body || document.documentElement).appendChild(sessionBanner);
  }

  function handleAuthError(response, payload, fallbackMessage) {
    if (response && response.status === 401) {
      try { window.dispatchEvent(new CustomEvent('club:session-expired')); } catch (_error) { /* ignore */ }
      var expired = new Error(t('common.sessionExpired'));
      expired.status = 401;
      expired.code = 'session_expired';
      return expired;
    }
    var message = payload && typeof payload === 'object' && payload.error ? payload.error : (fallbackMessage || t('common.requestFailed'));
    var error = new Error(String(message));
    if (response && response.status) error.status = response.status;
    return error;
  }

  window.addEventListener('club:session-expired', showSessionBanner);

  /* ---------- 全局 toast 通知 ----------
     ClubCommon.toast({ message, kind: 'ok'|'error'|'warn'|'info', duration })
     message 由调用方先经 t() 翻译；同一时刻最多保留 4 条。 */
  var toastHost = null;
  var toasts = [];

  function toast(options) {
    var opts = typeof options === 'string' ? { message: options } : (options || {});
    injectStyle();
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.createElement('div');
      toastHost.className = 'club-common-toast-host';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(toastHost);
    }
    while (toasts.length >= 4) dismissToast(toasts[0]);
    var item = document.createElement('div');
    item.className = 'club-common-toast' + (opts.kind && opts.kind !== 'info' ? ' club-common-' + opts.kind : '');
    var text = document.createElement('span');
    text.textContent = opts.message == null ? '' : String(opts.message);
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', t('common.dismiss'));
    close.textContent = '×';
    item.append(text, close);
    toastHost.appendChild(item);
    requestAnimationFrame(function () { item.classList.add('club-common-toast-in'); });

    var entry = { node: item, timer: null };
    toasts.push(entry);
    function dismissToast(target) {
      var index = toasts.indexOf(target);
      if (index >= 0) toasts.splice(index, 1);
      if (!target.node || !target.node.isConnected) return;
      if (target.timer) { clearTimeout(target.timer); target.timer = null; }
      target.node.classList.remove('club-common-toast-in');
      target.node.classList.add('club-common-toast-out');
      setTimeout(function () {
        if (typeof target.node.remove === 'function') target.node.remove();
        else if (target.node.parentNode) target.node.parentNode.removeChild(target.node);
      }, 240);
    }
    entry.dismiss = function () { dismissToast(entry); };
    close.addEventListener('click', entry.dismiss);
    entry.timer = setTimeout(entry.dismiss, Math.max(1200, Number(opts.duration) || 3400));
    return entry;
  }

  /* ---------- 按钮 busy 态 ----------
     setBusy(button, true)  记住原文案、加 is-loading 并禁用；
     setBusy(button, false) 恢复。返回按钮方便链式调用。 */
  function setBusy(button, busy) {
    if (!button) return button;
    if (busy) {
      if (!button.dataset.clubBusyText) button.dataset.clubBusyText = button.textContent;
      button.classList.add('is-loading');
      button.disabled = true;
    } else {
      button.classList.remove('is-loading');
      button.disabled = false;
      if (button.dataset.clubBusyText) {
        button.textContent = button.dataset.clubBusyText;
        delete button.dataset.clubBusyText;
      }
    }
    return button;
  }

  /* ---------- 数值脉冲 ----------
     数据刷新后对承载数字的元素触发一次 600ms 高亮脉冲
     （club-ui.css 的 .club-num-pulse）。先移除再强制回流，
     保证连续两次更新都能重新触发动画。 */
  function pulse(el) {
    if (!el || !el.classList) return el;
    el.classList.remove('club-num-pulse');
    void el.offsetWidth;
    el.classList.add('club-num-pulse');
    return el;
  }

  // CSV 导出：带 BOM，Excel 打开中文不乱码；单元格按 RFC 4180 转义。
  function csvCell(value) {
    var text = String(value == null ? '' : value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportCsv(filename, columns, rows) {
    var header = columns.map(function (column) { return csvCell(column.label); });
    var body = rows.map(function (row) {
      return columns.map(function (column) {
        var value = typeof column.value === 'function' ? column.value(row) : row[column.key];
        return csvCell(value);
      });
    });
    var csv = '\uFEFF' + [header].concat(body).map(function (line) { return line.join(','); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return rows.length;
  }

  // 客户端分页：返回当前页数据与页码状态，渲染交给调用方。
  function paginate(items, page, pageSize) {
    var size = Math.max(1, Number(pageSize) || 20);
    var list = Array.isArray(items) ? items : [];
    var totalPages = Math.max(1, Math.ceil(list.length / size));
    var current = Math.min(Math.max(1, Number(page) || 1), totalPages);
    var start = (current - 1) * size;
    return {
      items: list.slice(start, start + size),
      page: current,
      pageSize: size,
      total: list.length,
      totalPages: totalPages,
      hasPrev: current > 1,
      hasNext: current < totalPages,
      hidden: totalPages <= 1
    };
  }

  global.ClubCommon = {
    t: t,
    escapeHtml: escapeHtml,
    confirm: confirm,
    scheduleUndo: scheduleUndo,
    toast: toast,
    setBusy: setBusy,
    pulse: pulse,
    listState: listState,
    listStateHtml: listStateHtml,
    handleAuthError: handleAuthError,
    showSessionBanner: showSessionBanner,
    exportCsv: exportCsv,
    paginate: paginate,
    ready: ready
  };

  // 页面关闭前把仍待提交的删除立刻发出；调用方的 commit 应使用 keepalive。
  window.addEventListener('pagehide', function () {
    pendingCommits.forEach(function (entry) { try { entry.flush(); } catch (_error) { /* ignore */ } });
  });
})(window);
