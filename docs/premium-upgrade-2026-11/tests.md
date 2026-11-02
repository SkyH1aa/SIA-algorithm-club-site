# 本轮实际回归执行记录

日期：2026-11-01，Node v24.19.0，Windows/Git Bash。本记录是本地命令结果，不是远端 CI 运行结果。

## 通过

- 教学与保真：test-home-capabilities、test-premium-page-contracts。独立最短路真值、alpha-beta界限、BFS、对称矩阵、双语渲染、键盘与有限播放器生命周期通过。49页原脚本/ID/链接契约及7项冻结依赖通过；公告摘要的唯一有意内联修改按前后哈希校验，Hero和场景保护保留。
- 共享UI：check-ui-tokens、test-club-common、test-club-share、test-club-launcher-favorites、test-club-shell-interactions、test-club-reveal-lifecycle、test-theme-system。
- 首页场景：test-home-scene-startup、test-scene-lifecycle、test-scene-field-equivalence。2592点、2592组六采样法线、648条42/64步光线，最大绝对误差0。
- Chat/助手：test-chat-core、test-chat-thinking、test-chat-admin（179次模拟请求）、test-assistant-launcher、test-assistant-knowledge。无付费或上游调用。
- 页面：test-club-donations-page、test-club-donations-ui、test-notifications、test-member-profile、test-admin-hub、test-site-search、test-brand-mark、test-error-pages、test-404-page。
- 静态与发布资源：test-i18n-dict、test-seo、test-pwa、version-static-assets --check、test-asset-versions。36项哈希资源、532处引用一致。新增脚本语法和 git diff --check 通过（Git提示LF/CRLF转换，不是空白错误）。
- 数据保护：build-gomoku-training-model、构建脚本与模型产物语法检查、test-gomoku-training-policy（1080例）、test-gomoku-satori、verify-gomoku-satori-vcf。训练模型重建后无Git内容差异，未改变数据目录或模型强度。本轮不据此声称完成完整换色对局。
- 更新日志仅改 changelog.json 后运行 build-changelog-data，快照58项。

以上工具位于 tools/，后缀均为 .mjs。新增首页保真/教学与reveal生命周期测试已接入现有CI定义。

## 已知失败

`node tools/build-chat-dashboard-bundles.mjs --check` 整体退出1：Chat与Chat API proxy包通过，随后报 `club-drive-dashboard-index.ts is stale`。后续SQL副本检查未执行。

只读追溯确认构建器、drive源文件和存储包均与HEAD一致；drive包自2026-10-23起已与提交内源码不同步，与本轮前端变更无关。没有为通过检查而重建后端包或改后端逻辑。因此不能宣称全部CI绿灯。

## 测试边界

VM/源码检查不等于真实账号、触摸设备、file://、完整游戏或所有浏览器画面的认证。真实GUI与性能范围见 [acceptance.md](acceptance.md)。风格检测仍存在历史/规则冲突提示，未宣称风格lint全绿；用户已批准的局部玻璃和结构性阴影不因通用风格禁令自动删除。
