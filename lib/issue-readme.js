/**
 * 导出到 dist/ 的 README.md 内容
 */
module.exports = `# 老马Web — 内容更新说明

本静态站点支持通过 GitHub Issues 自动更新内容。
涉及到图片的有能力可以自己放图床之后放外链，也可以给我网盘的链接（用网盘得手动更新，比较慢，优先外链）

## 提交流程

1. 新建 Issue
2. 按下面的模板填写内容
3. 等待管理员审核
4. 审核通过后系统会自动更新并部署

---

## 新增代表作品

\`\`\`text
type: works
category: 电视剧
title: 作品标题
role: 饰演角色
year: 2025 或 2025-03-01（上映时间，用于排序展示）
director: 导演
poster: https://example.com/poster.jpg
sourceUrl: https://example.com/official（原始链接，用于跳转查看）
synopsis: 一句话简介
images:
  - https://example.com/still1.jpg
  - https://example.com/still2.jpg
\`\`\`

## 新增写真集---自己拍的照片，公开的照片都行，如果是他拍的线下活动照片，请提前询问原作者，并附带原作者同意的截图，谢谢

\`\`\`text
type: album
date: 2026-09-06（发帖日期，年月日；不知道可留空）
title: 写真集标题
author: 摄影师 / 来源作者（必填）
sourceUrl: https://example.com/original（原始链接，用于跳转查看）
cover: https://example.com/cover.jpg
images:
  - https://example.com/photo1.jpg
  - https://example.com/photo2.jpg
  - https://example.com/photo3.jpg
\`\`\`

## 补充图片——往已有图集 / 作品里追加照片

\`\`\`text
type: append
id: a-xxxxxxxx（目标 ID：图集详情页链接里的 ?album=… 或作品页 ?work=…）
images:
  - https://example.com/new1.jpg
  - https://example.com/new2.jpg
\`\`\`

- 图片会**追加到该内容已有图片的末尾**，不会替换或打乱原有顺序；重复的图片自动跳过。
- 怎么拿 ID：打开要补充的图集 / 作品详情页，复制地址栏链接（形如 \`https://www.qmqmqq.love/gallery?album=a-xxxxxx\`），整条粘贴到 \`id:\` 也行。
- \`id\` 也可以直接填 \`a-xxxxxx\`（图集）或 \`w-xxxxxx\`（作品）。
- **只加图片**：标题不可修改；作者 / 年份 / 导演等元数据留空即不改动。
- 目标内容若原本没有封面 / 海报，本次第一张图会自动补为封面 / 海报。

## 新增动态---比如什么新作品上映

\`\`\`text
type: news
date: 2026.03
title: 动态标题
summary: 动态摘要
sourceUrl: https://example.com/original（原始链接，可选）
\`\`\`

## 新增荣誉---指获了什么奖项

\`\`\`text
type: awards
year: 2025
name: 奖项名称
org: 颁奖方
work: 关联作品
\`\`\`

## 新增行程---啊吧啊吧

\`\`\`text
type: schedule
date: 2026.03.12
city: 城市
event: 活动事项
sourceUrl: https://example.com/original（原始链接，可选）
\`\`\`

## 站点留言（访客提交 / 手工补录，需审核）

网站表单提交的留言会自动生成带 \`comment-pending\` 标签的 Issue；
**审核 = 把标签改成 \`approved\`**（拒绝可保持待审或直接关闭），系统处理后会自动评论并关闭 Issue，下次导出生效。
手工补录留言按下面格式新建 Issue（记得打上 \`approved\` 标签）：

\`\`\`text
type: comment
page: album-a-xxxx（或 work-w-xxxx / news）
nickname: 昵称（留空显示 马铃薯）
content: 留言内容（单行）
date: 2026-09-06
replyto: c-xxxx（可选，回复某条留言）
\`\`\`

---

## 一条 Issue 可以提交多条内容

同一个 Issue 里可以包含多个内容块（比如一次提交 2 部作品），每条以 \`type:\` 开头即可：

\`\`\`text
type: works
category: 短剧
title: 作品一
role: 角色一
year: 2025-11-12
director: 导演一
sourceUrl: https://example.com/1
poster: https://example.com/p1.jpg
synopsis: 简介一
images:

type: works
category: 短剧
title: 作品二
role: 角色二
year: 2025-12-26
director: 导演二
sourceUrl: https://example.com/2
poster: https://example.com/p2.jpg
synopsis: 简介二
images:
  - https://example.com/s1.jpg
  - https://example.com/s2.jpg
\`\`\`

**约定（务必遵守）：**
1. 每条内容块**必须**以 \`type:\` 开头，系统按此切块；
2. 块与块之间**必须换行分隔**（上一块的 \`images:\` 后面换行后，再写下一条块的 \`type:\`——不要写在同一行，否则会被当成图片地址）；
3. 每个块的图片列表放在**自己块内**的 \`images:\` 下面；
4. 类型可以是 works / album / news / awards / schedule / append 任意混排。
`;
