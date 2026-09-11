# 主题系统

主题为 ZIP 压缩包，上传后在管理后台「主题」分区激活。激活后**主题目录会按路径覆盖默认 `site/` 的全部文件**（不只是首页）：
请求 `/`、`/about.html`、`/css/editorial.css` 等任意路径时，都会**先查主题目录**，命中则返回主题文件，未命中才回退默认站点。

## 两种用法

### 1. 轻量换肤（推荐）：同名覆盖 editorial.css，全站生效

所有页面（首页 + 子页面）都引用 `/css/editorial.css`。主题里提供**同名文件**即可让整站换肤，无需复制任何 HTML：

```
my-theme.zip
├── css/
│   ├── base.css             # 当前 editorial.css 的副本（基底，见下）
│   └── editorial.css        # @import "base.css"; 然后只写变量与覆盖层
└── theme.json
```

**推荐做法（内置主题即此模式）**：`editorial.css` 只做覆盖层，首行 `@import url("base.css");`，
`base.css` 是**官方 `site/css/editorial.css` 的副本**。这样新组件（评论、筛选、灯箱、动效等）
自动继承官方样式，主题只需覆盖配色变量与少量视觉细节。

### 2. 整站打包：全新页面结构

主题包含完整的页面与资源，激活后整个站点（首页 + 全部子页面）使用主题自己的结构与样式：

```
my-theme.zip
├── index.html               # 首页（引用主题自己的 css/js）
├── about.html               # 关于页
├── gallery.html             # 写真/图集页
├── works.html               # 作品页
├── news.html                # 动态页
├── awards.html              # 荣誉页
├── schedule.html            # 行程页
├── css/
│   └── your-style.css
├── js/                      # 可选用自己的脚本；默认站点脚本仍可直接引用 /js/xxx.js
└── theme.json
```

子页面 JS 依赖说明：默认子页面由 `/js/cms.js` + `/js/page.js` / `/js/gallery.js` 渲染
（数据来自 `/js/config.js` 与 `/js/data-gallery.js`）。整站打包时**建议保留这些引用**，
只替换 HTML 外壳与样式，即可继续沿用内容渲染能力；若完全自绘，则需自行处理数据渲染。

## ⚠️ base.css 必须跟随官方更新（重要）

`base.css` 是官方样式的**静态快照**，不会自动更新。核心样式变更后，旧快照会缺失新组件的样式：

- 实测（2026-09-10）：内置主题的 `base.css` 停留在 9/6 版本，缺 4 个章节约 13KB——
  **动效引擎接入、hero 叠层覆盖、hero 下滑引导、图集列表分批哨兵**
- 后果不只是"不好看"，有两个**功能性**问题：
  1. **灯箱双指缩放失灵**：缺 `.lightbox { touch-action: none }` → 与浏览器自身手势抢占
  2. **GSAP 动画变卡顿**：缺 `html.motion-gsap ... { transition-property: ... }` 覆盖 →
     GSAP 每帧写 inline style，而 CSS 过渡仍在，形成"惯性跟随"

**刷新方法**：把 `site/css/editorial.css` 复制为 `themes/<name>/css/base.css`，保持覆盖层不变，
重新打包 zip。注意 `themes/*/css/base.css`（目录内）与 `theme-packages/*.zip`（分发包）是**两份独立副本**，
必须**同时更新**，否则后台装回来的仍是旧版。

## theme.json

可选，用于后台展示：

```json
{
  "label": "我的主题",
  "description": "主题描述"
}
```

## 注意事项

- ZIP 至少需包含 `index.html` 或 `css/` 目录，否则上传会被拒绝
- 主题**只能覆盖已有路径**，无法新增路由；新增页面请同时放进 `site/`
- 主题目录与分发包**都要更新**（见上）；上传同名主题会被拒绝（需先删旧目录）
- 激活回默认主题：后台点击「Editorial（内置默认）」启用即可
- 导出 dist 时，激活主题的文件会覆盖合并进 `dist/`（同名文件以主题为准）
- **主题不包含插件资源**：首页宠物（hero-pet）等插件由导出/路由单独注入，主题无需处理
- 换肤主题不必关心 `data-gallery.js`（图集数据已从主 config 拆出，独立懒加载）

## 内置主题

| 目录 | 名称 | 风格 |
| --- | --- | --- |
| `stage-spotlight/` | 舞台聚光灯 Stage Spotlight | 舞台紫黑场刊风：镭射流光标题、荧光描边、聚光光斑与金色奖牌 |
| `sweet-idol/` | 甜心应援 Sweet Idol | 樱白底 × 应援粉：拍立得写真、演出票根行程、贴纸描边标题与心跳动效 |

两个内置主题均为**轻量换肤**型（无 HTML，只有 `css/`），共用同一份 official 基底。
