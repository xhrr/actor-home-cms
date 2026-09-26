# 主题系统

主题是一个 ZIP 压缩包，上传后在管理后台「主题」分区激活。激活之后，主题目录会按路径覆盖默认 `site/` 的全部文件——不只是首页。请求 `/`、`/about.html`、`/css/editorial.css` 等任意路径时都先查主题目录，命中就返回主题文件，没命中才回退默认站点。

## 两种用法

### 一、轻量换肤（推荐）

全站所有页面都引用 `/css/editorial.css`，所以主题里放一个**同名文件**就能整站换肤，一行 HTML 都不用抄：

```
my-theme.zip
├── css/
│   ├── base.css             # 官方 editorial.css 的完整副本（基底）
│   └── editorial.css        # 首行 @import "base.css"; 然后只写变量和覆盖层
└── theme.json
```

内置主题都是这个模式：`editorial.css` 只做覆盖层，`base.css` 是官方样式的静态快照。好处是官方这边加了新组件（评论、筛选、灯箱、动效），主题不用动就自动继承。

### 二、整站打包

想把页面结构也换掉，就在主题里带完整的 HTML：

```
my-theme.zip
├── index.html
├── about.html / gallery.html / works.html / news.html / awards.html / schedule.html
├── css/your-style.css
├── js/                      # 可以用自己的脚本
└── theme.json
```

子页面的内容渲染靠 `/js/cms.js` + `/js/page.js` / `/js/gallery.js`，数据来自 `/js/config.js` 和 `/js/data-gallery.js`。整站打包时建议保留这些引用，只换外壳和样式，渲染能力还能接着用；完全自绘就要自己处理数据了。

## base.css 必须跟着官方更新（这条最重要）

`base.css` 是快照，不会自己更新。官方样式演进了而快照没跟上时，缺的不只是好看，会出功能问题——这不是假设，实际发生过：内置主题的 base.css 停在旧版本，缺了四个章节约 13KB，后果有两个：

1. 灯箱双指缩放失灵——缺 `.lightbox { touch-action: none }`，浏览器自身手势会跟缩放抢占
2. GSAP 动画变卡——缺 `html.motion-gsap ...` 的过渡覆盖，GSAP 每帧写 inline style 而 CSS 过渡还在跑，动效变成惯性跟随

刷新方法：把 `site/css/editorial.css` 复制成 `themes/<name>/css/base.css`，覆盖层不动，重新打包 zip。注意 `themes/<name>/css/base.css`（目录内）和 `theme-packages/*.zip`（分发包）是两份独立的副本，**必须同时更新**——只改目录里的，后台从 zip 装回来的还是旧的。

## theme.json

可选，给后台展示用：

```json
{
  "label": "我的主题",
  "description": "主题描述"
}
```

## 其他要注意的

- ZIP 至少要包含 `index.html` 或 `css/` 目录，否则上传会被拒绝
- 主题只能覆盖已有路径，加不了新路由；新页面请同时放进 `site/`
- 上传同名主题会被拒绝，得先删旧目录
- 想回到默认：后台点「Editorial（内置默认）」启用即可
- 导出 dist 时，激活主题的文件会覆盖合并进 dist（同名以主题为准）
- 主题不用管插件资源——hero-pet、hero-photo 这类插件由导出和路由单独注入
- 换肤主题也不用关心 `data-gallery.js`，图集数据早就从主 config 拆出去独立懒加载了

## 内置主题

| 目录 | 名称 | 风格 |
| --- | --- | --- |
| `stage-spotlight/` | 舞台聚光灯 Stage Spotlight | 舞台紫黑场刊风：镭射流光标题、荧光描边、聚光光斑与金色奖牌 |
| `sweet-idol/` | 甜心应援 Sweet Idol | 樱白底 × 应援粉：拍立得写真、演出票根行程、贴纸描边标题与心跳动效 |
