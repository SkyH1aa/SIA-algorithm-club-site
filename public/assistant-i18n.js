(() => {
  const zh = {
    title:'小Bru · 社团助手', assistant:'小Bru', emptyTitle:'你好，我是小Bru',
    emptyBody:'你好，我是新哲文院算法社的社团 AI 助手小Bru。可以帮你了解网站使用与学习资源，也可以交流编程和算法。可按问题选择只读工具，查询已发布公告/活动、社员积分和六个游戏榜单，支持条件筛选、升降序与分页（第1–100页，每页1–50条）；请结合来源、查询时间和结果范围核对。',
    placeholder:'询问社团、学习资源或网站使用方法…',
    privacy:'对话与附件会保留在这台设备，并由社团按管理要求保存副本。发送时，问题、相关历史、摘要、附件、相关已发布资料和本轮实时查询结果会交给社团配置的模型处理。请勿发送密码或敏感个人信息。',
    liveQuery:'按{metric}{direction} · 第 {page} 页 · 每页最多 {n} 条', liveDirection_asc:'升序', liveDirection_desc:'降序', liveReturned:'本次返回 {n} 条；页内顺序不代表全榜名次。', liveMore:'还有更多结果可查询。',
    liveMetric_points:'积分', liveMetric_member_name:'姓名', liveMetric_nickname:'昵称', liveMetric_username:'用户名', liveMetric_total_score:'总分', liveMetric_high_score:'最高分/分差', liveMetric_games_played:'对局数', liveMetric_wins:'胜局数', liveMetric_losses:'负局数', liveMetric_draws:'和局数', liveMetric_total_moves:'总步数', liveMetric_default:'默认排序', liveMetric_created_at:'创建时间', liveMetric_updated_at:'更新时间', liveMetric_starts_at:'开始时间', liveMetric_ends_at:'结束时间',
    estimate:'上下文已预留社团资料、工具定义与固定规则所需空间；token 用量为估算。',
    assistant_unavailable:'社团助手暂时不可用，请稍后重试。',
    fixedModel:'社团知识助手', sourceLabel:'资料来源', publicationVersion:'发布版本', liveSource:'实时只读查询', queriedAt:'查询时间', liveStatus_success:'已读取', liveStatus_empty:'无匹配结果', liveStatus_unavailable:'查询不可用', liveStatus_paused:'功能暂停', liveStatus_ambiguous:'需明确查询对象', liveLimit:'本次最多查询 {n} 条；仅代表查询时的可见数据。', liveTruncated:'仅显示本次查询范围，最多 {n} 条，结果已截断。', close:'关闭助手'
  };
  const en = {
    title:'Bru · Club Assistant', assistant:'Bru', emptyTitle:'Hello, I’m Bru',
    emptyBody:'Hello, I am 小Bru, the AI assistant of 新哲文院算法社. Ask about the site, learning resources, programming, or algorithms. Read-only tools can query published announcements/events, member points and six game boards, with filters, ascending/descending order and bounded pages (1–100, 1–50 rows each). Check sources, query times and result scope.',
    placeholder:'Ask about the club, learning resources, or this website…',
    privacy:'Chats and attachments remain on this device and the club keeps an administrative copy. Your question, relevant history, summary, attachments, relevant published knowledge and current live-query results are sent to the model configured by the club. Do not send passwords or sensitive personal information.',
    liveQuery:'Order {direction} by {metric} · Page {page} · Up to {n} rows per page', liveDirection_asc:'ascending', liveDirection_desc:'descending', liveReturned:'Returned {n} rows; page order is not a global rank.', liveMore:'More results are available.',
    liveMetric_points:'points', liveMetric_member_name:'member name', liveMetric_nickname:'nickname', liveMetric_username:'username', liveMetric_total_score:'total score', liveMetric_high_score:'high score / score difference', liveMetric_games_played:'games played', liveMetric_wins:'wins', liveMetric_losses:'losses', liveMetric_draws:'draws', liveMetric_total_moves:'total moves', liveMetric_default:'default order', liveMetric_created_at:'creation time', liveMetric_updated_at:'update time', liveMetric_starts_at:'start time', liveMetric_ends_at:'end time',
    estimate:'Space for club knowledge, tool definitions and fixed rules is reserved. Token usage is approximate.',
    assistant_unavailable:'The club assistant is temporarily unavailable. Please try again later.',
    fixedModel:'Club knowledge assistant', sourceLabel:'Sources', publicationVersion:'Publication version', liveSource:'Live read-only query', queriedAt:'Queried at', liveStatus_success:'Retrieved', liveStatus_empty:'No matching results', liveStatus_unavailable:'Query unavailable', liveStatus_paused:'Feature paused', liveStatus_ambiguous:'Clarification required', liveLimit:'Up to {n} records; data reflects only this query time and visibility.', liveTruncated:'Limited query scope: up to {n} records; results were truncated.', close:'Close assistant'
  };
  const merge = () => ClubI18n.mergeDict({zh:{assistant:zh},en:{assistant:en}});
  if (window.ClubI18n) merge(); else window.addEventListener('DOMContentLoaded', merge, {once:true});
})();
