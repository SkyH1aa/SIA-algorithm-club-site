(() => {
  const zh = {
    title:'社团助手', assistant:'社团助手', emptyTitle:'有什么可以帮你？',
    emptyBody:'了解社团、查找网站功能与学习资源。回答中的资料引用可打开原页面核对。',
    placeholder:'询问社团、学习资源或网站使用方法…',
    privacy:'对话与附件仅保存在这台设备的当前账号下，与 AI 对话记录分开。发送时，问题、相关历史、摘要和附件会交给社团配置的模型处理。请勿发送密码或敏感个人信息。',
    estimate:'上下文已预留社团资料与固定规则所需空间；token 用量为估算。',
    assistant_unavailable:'社团助手暂时不可用，请稍后重试。',
    fixedModel:'社团知识助手', sourceLabel:'资料来源', publicationVersion:'发布版本', close:'关闭助手'
  };
  const en = {
    title:'Club Assistant', assistant:'Club Assistant', emptyTitle:'How can I help?',
    emptyBody:'Explore the club, site features, and learning resources. Open cited pages to check the original information.',
    placeholder:'Ask about the club, learning resources, or this website…',
    privacy:'Chats and attachments are stored on this device under your current account, separately from AI Chat. Your question, relevant history, summary, and attachments are sent to the model configured by the club. Do not send passwords or sensitive personal information.',
    estimate:'Space for club knowledge and fixed rules is reserved. Token usage is approximate.',
    assistant_unavailable:'The club assistant is temporarily unavailable. Please try again later.',
    fixedModel:'Club knowledge assistant', sourceLabel:'Sources', publicationVersion:'Publication version', close:'Close assistant'
  };
  const merge = () => ClubI18n.mergeDict({zh:{assistant:zh},en:{assistant:en}});
  if (window.ClubI18n) merge(); else window.addEventListener('DOMContentLoaded', merge, {once:true});
})();
