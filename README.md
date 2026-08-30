# Actor Home CMS

一个**演员主页 CMS**，摄影师作品集升级为**完全插件化**架构。
默认主页使用 **Editorial 编辑杂志风**：暖米色、柔和黑、衬线标题、无阴影、无圆角、大量留白。

## 功能

- **演员主页**：姓名、英文名、定位语、头像/封面、代表作品、关于、写真、动态、荣誉、行程、社交链接
- **插件系统**：
  - 前端模块插件：通过 `window.CMS.registerModule()` 注册新首页模块
  - 后端插件：通过 `server.js` 注册路由、读写独立数据
  - 后台面板插件：通过 `window.AdminCMS.registerPluginPanel()` 提供设置面板
  - 生命周期：插件可注册 `onExport` 钩子
  - ZIP 安装 / 启停 / 数据管理
- **Editorial 默认主题**：纯单色、无阴影、无大圆角、衬线标题、hover-underline
- **主题系统**：支持 ZIP 上传、激活、导出覆盖
- **独立内容页**：
  - `/about.html` — 关于演员完整介绍
  - `/works.html` — 全部代表作品
  - `/gallery.html` — 全部写真/剧照
  - `/news.html` — 全部动态
  - `/awards.html` — 全部荣誉
  - `/schedule.html` — 全部行程
- **首页只展示部分数据**，数据变多后自动通过「查看全部」跳转到对应独立页
- **无限自定义首页模块**：后台模块管理可无限新增文本/图片/作品/动态等模块，支持自定义内容和排序
- **静态导出**：一键导出纯静态站点到 `dist/`，可下载 ZIP 并部署到 Cloudflare Pages / GitHub Pages
- **媒体库**：本地上传与 R2 远程外链合并管理，一键复制链接
- **GitHub Issues 内容更新**：审核通过的 Issue 自动解析并更新内容、关闭 Issue、自动导出并推送部署
- **Cloudflare R2 图片上传**：批量上传、可选 WebP 压缩/缩放、自定义 key 规则，上传后自动收录媒体库
- **GitHub 部署**：导出后一键推送 dist 到任意 GitHub 仓库（GitHub Pages）

## 快速开始

```bash
npm install
npm start
```

访问：

| 地址 | 用途 |
|------|------|
| http://localhost:3000 | 演员主页 |
| http://localhost:3000/admin | 管理后台 |
| http://localhost:3000/gallery.html | 图集页 |
| http://localhost:3000/about.html | 关于页 |
| http://localhost:3000/works.html | 全部作品页 |
| http://localhost:3000/news.html | 全部动态页 |
| http://localhost:3000/awards.html | 全部荣誉页 |
| http://localhost:3000/schedule.html | 全部行程页 |

### 导出静态网页并部署到 Cloudflare Pages（完整流程）

**第一步：导出静态站点**

管理后台 →「导出部署」→ 点击「导出到 dist/」（或 `POST /api/export`）。`dist/` 即完整静态站：

```text
dist/
├── index.html / works.html / gallery.html ...   # 页面
├── css/editorial.css                            # 样式
├── js/                                          # 前端脚本（含站点配置）
├── uploads/                                     # 本地图片（如有）
├── _headers                                     # 安全响应头（自动生效）
└── wrangler.toml                                # Cloudflare 项目配置
```

**第二步：把 dist 推送到 GitHub 仓库**

推荐用后台自带插件（全自动）：

1. 打开一个专门存放静态站的仓库（如 `https://github.com/你的账号/actor-home-pages`，新建并保持为空即可）
2. 后台「插件管理」→ **GitHub 部署** 插件 → 配置仓库地址 / Token / 分支（main）→ 点「推送部署」
3. 仓库根目录即为静态站内容（`index.html` 在根），也可调用 `POST /api/plugins/github-deploy/push` 触发

> 提示：配合「GitHub Issues 内容更新」插件，Issue 审核通过后会自动导出并推送，无需手动操作。

**第三步：Cloudflare Pages 连接 GitHub（自动部署）**

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers 和 Pages** → **创建** → **Pages** → **连接到 Git**
2. 授权 Cloudflare 访问你的 GitHub（可只授权那一个静态站仓库）
3. 选择刚推入 dist 的仓库：
   - **框架预设**：无（None）
   - **构建命令**：留空
   - **构建输出目录**：`/`（仓库根目录就是网页根）
4. 点击「保存并部署」，自动生成地址 `https://<project-name>.pages.dev`

**第四步：内容更新全自动闭环**

- 以后每次后台更新内容 → 导出 → 推送 GitHub → **Cloudflare 监听仓库变更自动重新部署**，全程无需登录 Cloudflare 控制台
- 手动更新：重复「导出 + 点一下 GitHub 部署插件的推送」
- 全自动更新：GitHub Issues 插件（审核通过的 Issue 自动更新内容、导出并推送）

**绑定自定义域名（可选）**

Cloudflare Pages 项目 → **自定义域** → 添加域名（如 `www.example.com`），按提示设置 CNAME 指向 `<project-name>.pages.dev`，等待生效即可 HTTPS 访问；`dist/_headers` 安全头随部署自动生效。

## 项目结构

```text
.
├── server.js                # Express 服务器 + API
├── plugin-loader.js         # 插件扫描/加载/数据
├── package.json
├── lib/                     # 后端核心
│   ├── core.js              # 配置/路径/存储核心
│   ├── media-store.js       # 媒体库远程条目存储
│   └── routes/              # 配置/插件/主题/导出/站点路由
├── data/                    # 运行数据（不入库，含密钥）
│   ├── config.json          # 全部内容与插件数据
│   ├── plugins.json         # 插件安装/启用状态
│   └── media.json           # 媒体库远程条目
├── site/                    # 前端站点（Editorial 默认主题）
│   ├── index.html
│   ├── gallery.html
│   ├── works.html
│   ├── news.html
│   ├── awards.html
│   ├── schedule.html
│   ├── css/editorial.css
│   └── js/
│       ├── cms.js           # 前端插件运行时 + 公共导航/显示工具
│       ├── core-modules.js  # 内置核心模块注册表
│       ├── main.js          # 首页渲染引擎
│       ├── gallery.js
│       └── page.js          # 独立内容页渲染器
├── admin/                   # 管理后台
├── plugins/                 # 插件目录
│   ├── cloudflare-r2/       # R2 图片上传（批量/WebP/媒体库）
│   ├── github-deploy/       # GitHub 部署推送
│   ├── github-issues/       # GitHub Issues 内容更新
│   └── hello-world/         # 最小插件示例
├── themes/                  # 主题
├── uploads/                 # 上传图片（不入库）
└── dist/                    # 导出静态站（不入库）
```

## 插件开发

### 插件目录结构

```text
my-plugin/
├── manifest.json
├── client.js        # 前端模块渲染器（可选）
├── server.js        # 后端路由/钩子（可选）
├── admin.js         # 后台设置面板（可选）
└── assets/          # 静态资源（导出时复制）
```

### manifest.json 示例

```json
{
  "name": "my-plugin",
  "label": "我的插件",
  "version": "1.0.0",
  "description": "描述",
  "author": "you",
  "client": "client.js",
  "server": "server.js",
  "admin": "admin.js",
  "assets": ["assets/"],
  "modules": ["hello"]
}
```

### client.js

```js
(function () {
  const C = window.SITE_CONFIG;
  const U = window.CMS.utils;

  window.CMS.registerModule('hello', function (mod, idx) {
    return `<section class="section section--plugin">
      <h2>${U.esc(mod.text || 'Hello')}</h2>
    </section>`;
  }, { nav: { href: '#hello', text: 'Hello' } });
})();
```

### 生命周期钩子

插件 `server.js` 可以导出函数，也可以导出对象：

```js
module.exports = {
    setup(ctx) {
        ctx.app.get('/api/plugins/my-plugin/ping', (req, res) => {
            res.json({ data: ctx.getData() });
        });
    },
    hooks: {
        onLoad(ctx) { /* 插件启用时 */ },
        onExport(ctx) { /* 导出 dist 前，可写入额外资源 */ },
        onDeactivate(ctx) { /* 停用插件时 */ }
    }
};
```

插件上下文 `ctx` 提供：

- `ctx.app`：Express 实例
- `ctx.plugin`：插件名
- `ctx.manifest`：插件清单
- `ctx.getData()` / `ctx.setData(data)`：插件独立数据
- `ctx.media`：媒体库（`addRemote` / `removeRemote` / `listRemote`）
- `ctx.onExport`：可赋值为导出钩子函数
- `ctx.log(...)`：日志

### server.js（旧式函数写法仍然支持）

```js
module.exports = function (ctx) {
  ctx.app.get('/api/plugins/my-plugin/ping', (req, res) => {
    res.json({ data: ctx.getData() });
  });
  ctx.onExport = function (distDir) {
    // 导出钩子：可向 dist 写入额外资源
  };
};
```

### admin.js

```js
if (window.AdminCMS) {
  window.AdminCMS.registerPluginPanel('my-plugin', {
    label: '我的插件',
    render: function (data) { return `<input id="my-input" value="${window.AdminCMS.esc(data.text || '')}">`; },
    collect: function () { return { text: document.getElementById('my-input').value }; },
    bind: function () { /* 绑定事件 */ }
  });
}
```

### 安装插件

1. 将插件目录放入 `plugins/`，或打包 ZIP 后在管理后台/API 上传；
2. 在 `data/plugins.json` 中把插件加入 `enabled`，或在后台点「启用」；
3. 前端会自动加载 `/plugins/<name>/client.js`，后台自动加载 `/plugins/<name>/admin.js`。

## 导出部署

- 管理后台 → 导出部署 → 点击「导出到 dist/」
- 或调用 `POST /api/export`
- 下载 ZIP：`GET /api/export/download`
- 将 `dist/` 部署到任意静态托管

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 获取配置 |
| PUT | `/api/config` | 保存配置 |
| POST | `/api/upload` | 上传图片（本地媒体库） |
| GET | `/api/images` | 图片列表（本地 + 远程合并） |
| DELETE | `/api/images/:filename` | 删除本地图片 |
| DELETE | `/api/images/remote/:id` | 移除媒体库远程条目 |
| GET | `/api/plugins` | 插件列表 |
| POST | `/api/plugins/install` | ZIP 安装插件 |
| POST | `/api/plugins/:name/toggle` | 启停插件 |
| PUT | `/api/plugins/:name/data` | 保存插件数据 |
| GET | `/api/themes` | 主题列表 |
| POST | `/api/themes/upload` | 上传主题 |
| POST | `/api/export` | 导出静态站 |
| GET | `/api/export/download` | 下载 ZIP |
| POST | `/api/plugins/cloudflare-r2/test` | R2 连接测试 |
| POST | `/api/plugins/cloudflare-r2/upload` | R2 批量上传图片 |
| POST | `/api/plugins/github-issues/check` | 检查已批准 Issue |
| POST | `/api/plugins/github-deploy/push` | 推送 dist 到 GitHub |

## License

MIT
