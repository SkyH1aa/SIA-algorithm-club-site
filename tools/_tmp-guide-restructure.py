# -*- coding: utf-8 -*-
# guide.html：改为「三步上手」引导流程 + 图标信息面板
import io

path = 'public/guide.html'
src = io.open(path, encoding='utf-8').read()

STYLE = """  <style>
    /* 三步上手：编号圆点 + 卡片；面板图标与功能枢纽页同体系 */
    body.club-page .guide-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--club-gap); margin: 22px 0 26px; counter-reset: step; }
    body.club-page .guide-step { position: relative; padding: 18px 18px 16px; border: 1px solid var(--club-line); border-radius: var(--club-radius); background: var(--club-surface); box-shadow: var(--club-shadow-sm); }
    body.club-page .guide-step .step-num {
      display: inline-grid; place-items: center;
      width: 30px; height: 30px; margin-bottom: 10px;
      border-radius: 9px; background: var(--club-accent); color: var(--club-on-accent);
      font: 800 14px/1 var(--club-font); font-variant-numeric: tabular-nums;
    }
    body.club-page .guide-step strong { display: block; margin-bottom: 5px; font-size: 15px; }
    body.club-page .guide-step p { margin: 0; color: var(--club-muted); font-size: 13px; line-height: 1.65; }
    @media (max-width: 860px) { body.club-page .guide-steps { grid-template-columns: 1fr; } }

    body.club-page .guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--club-gap); }
    body.club-page .guide-grid .panel { margin: 0; }
    body.club-page .guide-grid .panel-wide { grid-column: 1 / -1; }
    body.club-page .panel-icon {
      display: inline-grid; place-items: center;
      width: 36px; height: 36px; margin-bottom: 10px;
      border-radius: 10px; background: var(--club-accent-soft); color: var(--club-accent);
    }
    body.club-page .panel-icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    body.club-page .guide-grid .panel h2 { display: block; }
    @media (max-width: 860px) { body.club-page .guide-grid { grid-template-columns: 1fr; } }
  </style>
</head>"""

src = src.replace('</head>', STYLE, 1)

ICONS = {
  'guide.accountTitle': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5"/></svg>',
  'guide.featuresTitle': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
  'guide.gamesTitle': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9h12a4 4 0 0 1 4 4v1.5a2.5 2.5 0 0 1-4.6 1.4L16 14H8l-1.4 1.9A2.5 2.5 0 0 1 2 14.5V13a4 4 0 0 1 4-4z"/><path d="M8 12h2M9 11v2M15.5 11.5h.01M17.5 13h.01"/></svg>',
  'guide.checkinTitle': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M9 15.5l2 2 4-4"/></svg>',
  'guide.themeTitle': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17"/><path d="M12 12a5 5 0 0 1 5-5 8.5 8.5 0 0 1-10 10 5 5 0 0 1 5-5z" stroke-width="0" fill="currentColor" opacity=".25"/></svg>',
  'guide.changelogTitle': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
}
for key, svg in ICONS.items():
    old = f'<article class="panel"><h2 data-i18n="{key}">'
    new = f'<article class="panel"><span class="panel-icon" aria-hidden="true">{svg}</span><h2 data-i18n="{key}">'
    assert old in src, key
    src = src.replace(old, new, 1)
old = '<article class="panel panel-wide"><span class="panel-icon"'
if old not in src:
    src = src.replace('<article class="panel panel-wide"><span class="panel-icon"', '<article class="panel panel-wide"><span class="panel-icon"', 1)

# 三步上手区块插到 guide-grid 之前
STEPS = """    <section class="guide-steps" aria-label="三步上手">
      <article class="guide-step"><span class="step-num">1</span><strong data-i18n="guide.step1Title">创建账号</strong><p data-i18n="guide.step1Desc">在个人中心使用邀请码注册，并登录社团账号。</p></article>
      <article class="guide-step"><span class="step-num">2</span><strong data-i18n="guide.step2Title">绑定资料</strong><p data-i18n="guide.step2Desc">绑定中文姓名与班级，即可查看个人资料与积分。</p></article>
      <article class="guide-step"><span class="step-num">3</span><strong data-i18n="guide.step3Title">选择模块</strong><p data-i18n="guide.step3Desc">从社团功能进入实验室、AI 游戏、签到与日常功能。</p></article>
    </section>
    <section class="guide-grid">"""
old_grid = '    <section class="guide-grid">'
assert old_grid in src
src = src.replace(old_grid, STEPS, 1)

# 扩展页内词典：三步键
OLD_DICT = """    const GUIDE_PAGE_DICT = {
      zh: { guide: { goFeatures: '前往社团功能 →' } },
      en: { guide: { goFeatures: 'Go to club features →' } }
    };"""
NEW_DICT = """    const GUIDE_PAGE_DICT = {
      zh: { guide: {
        goFeatures: '前往社团功能 →',
        step1Title: '创建账号', step1Desc: '在个人中心使用邀请码注册，并登录社团账号。',
        step2Title: '绑定资料', step2Desc: '绑定中文姓名与班级，即可查看个人资料与积分。',
        step3Title: '选择模块', step3Desc: '从社团功能进入实验室、AI 游戏、签到与日常功能。',
      } },
      en: { guide: {
        goFeatures: 'Go to club features →',
        step1Title: 'Create your account', step1Desc: 'Register with an invite code in Member Center and sign in.',
        step2Title: 'Bind your profile', step2Desc: 'Bind your Chinese name and class to view your profile and points.',
        step3Title: 'Pick a module', step3Desc: 'Open labs, AI games, check-in and daily tools from Club Features.',
      } }
    };"""
assert OLD_DICT in src
src = src.replace(OLD_DICT, NEW_DICT, 1)

io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('guide restructured')
