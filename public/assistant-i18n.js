(() => {
  const zh = {
    title:'小Bru · 社团助手', assistant:'小Bru', emptyTitle:'你好，我是小Bru',
    emptyBody:'你好，我是新哲文院算法社的社团 AI 助手小Bru。可以帮你了解网站使用与学习资源，也可以交流编程和算法。公告、积分和游戏榜单可按问题进行成员权限的实时只读查询；请结合来源、查询时间和结果范围核对。',
    placeholder:'询问社团、学习资源或网站使用方法…',
    privacy:'对话与附件仅保存在这台设备的当前账号下，与 AI 对话记录分开。发送时，问题、相关历史、摘要、附件、相关已发布资料和本轮实时查询结果会交给社团配置的模型处理。请勿发送密码或敏感个人信息。',
    estimate:'上下文已预留社团资料与固定规则所需空间；token 用量为估算。',
    assistant_unavailable:'社团助手暂时不可用，请稍后重试。',
    fixedModel:'社团知识助手', sourceLabel:'资料来源', publicationVersion:'发布版本', liveSource:'实时只读查询', queriedAt:'查询时间', liveStatus_success:'已读取', liveStatus_empty:'无匹配结果', liveStatus_unavailable:'查询不可用', liveStatus_paused:'功能暂停', liveStatus_ambiguous:'需明确查询对象', liveLimit:'本次最多查询 {n} 条；仅代表查询时的可见数据。', liveTruncated:'仅显示本次查询范围，最多 {n} 条，结果已截断。', close:'关闭助手'
  };
  const en = {
    title:'Bru · Club Assistant', assistant:'Bru', emptyTitle:'Hello, I’m Bru',
    emptyBody:'Hello, I am 小Bru, the AI assistant of 新哲文院算法社. Ask about the site, learning resources, programming, or algorithms. Announcements, points and game boards support member-level read-only queries. Check sources, query times and result scope.',
    placeholder:'Ask about the club, learning resources, or this website…',
    privacy:'Chats and attachments are stored on this device under your current account, separately from AI Chat. Your question, relevant history, summary, attachments, relevant published knowledge and current live-query results are sent to the model configured by the club. Do not send passwords or sensitive personal information.',
    estimate:'Space for club knowledge and fixed rules is reserved. Token usage is approximate.',
    assistant_unavailable:'The club assistant is temporarily unavailable. Please try again later.',
    fixedModel:'Club knowledge assistant', sourceLabel:'Sources', publicationVersion:'Publication version', liveSource:'Live read-only query', queriedAt:'Queried at', liveStatus_success:'Retrieved', liveStatus_empty:'No matching results', liveStatus_unavailable:'Query unavailable', liveStatus_paused:'Feature paused', liveStatus_ambiguous:'Clarification required', liveLimit:'Up to {n} records; data reflects only this query time and visibility.', liveTruncated:'Limited query scope: up to {n} records; results were truncated.', close:'Close assistant'
  };
  const merge = () => ClubI18n.mergeDict({zh:{assistant:zh},en:{assistant:en}});
  if (window.ClubI18n) merge(); else window.addEventListener('DOMContentLoaded', merge, {once:true});
})();
