# 本轮材质参考与实施边界

用户要求：iOS26风格的局部毛玻璃、随鼠标的主题光辉、更精致的企业级控件，以及解决首页右半屏空占位。直接实施，本地验证，不提交/推送/部署。

官方页面于2026-11-02通过内置浏览器实际读取。WebSearch与WebFetch在当前提供方不可用，未据此虚构搜索结果。

- Apple Human Interface Guidelines — Materials：https://developer.apple.com/design/human-interface-guidelines/materials
  - 材质用于区分前景/背景、建立深度和层级。
  - Liquid Glass主要用于导航与控件的功能层，稀疏使用；内容层使用standard materials。
  - regular更重视文本可读性；clear适合视觉丰富的背景。厚材质提供更稳定的对比度。
  - 本站借鉴CSS可实现的透射、磨砂、镜面边缘和交互光照，不声称复刻Apple原生光学折射或系统材质。
- Vercel Geist — Materials：https://vercel.com/geist/materials
  - 圆角、填充、描边、阴影按层级形成完整preset；surface与floating分开。
  - 使用足以区分的最低层级，避免重叠材质；键盘焦点与阴影共同传达状态。
  - 本站保留品牌字体与主题色，不搬用Vercel产品组件、标志或品牌内容。

本轮实现保持原Hero内容与顺序、原3D/章节脚本、业务权限/后端接口/模型强度及训练数据。首页通过CSS把原品牌与介绍分配到左右两栏，取消空观看占位，不以额外作品或虚构统计填满首屏。
