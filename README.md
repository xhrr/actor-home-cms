# Actor Home CMS

这是马倩倩应援站（www.qmqmqq.love）背后的一套演员主页 CMS。它最早是个摄影师作品集程序，后来为了应付「内容天天在更新、站长不想碰代码」的现实，一步步改成了完全插件化的架构：内容走 GitHub Issue 提交和审核，审核通过自动上线；图片丢 Cloudflare R2；微博和小红书的采集交给外部的知更（Zhigeng）程序，这边只负责消费它的数据。

默认主题叫 Editorial：暖米色底、柔和黑、衬线标题、无阴影、无圆角、大量留白。整个站的长相都是围绕它调的。

## 跑起来

```bash
npm install
npm start
```

默认 `http://localhost:3000`，后台在 `/admin`。图集、作品、动态、荣誉、行程都有独立页面，首页只放精选，多了就「查看全部」跳过去。

在我们自己的 NAS 上有条纪律：3000 端口一律不启用（历史事故），调试用别的端口或者直接上 3123 生产环境看。

## 部署

生产环境跑在 Docker 里，源码目录和部署目录是分开的：

```bash
cd /vol1/1000/actor/mqq
docker compose -p mqq-cms up -d --build   # 源码有改动：重建镜像并滚动更新
docker restart actor-home-cms             # 仅重启：加载挂载卷里的新内容
```

改代码之前先分清楚改动落在哪，这决定了要不要重建：

- `plugins/`、`site/`、`data/`、`themes/`、`uploads/`、`dist/` 是挂载卷——改了 cp 过去重启就生效。注意 `site/` 挂的是部署目录下的 site，不是源码树里的，得 cp 两次（或者直接改部署目录那份）；
- `lib/`、`admin/`、`server.js`、`plugin-loader.js` 打包在镜像里——必须重建。

公共站部署在 Cloudflare Pages：后台「导出部署」生成 `dist/`，github-deploy 插件推到 GitHub 仓库，Cloudflare 监听仓库变更自动重新部署。内容编辑走 GitHub Issues 提交，审核通过后这条链路全自动。

## 目录结构

```text
.
├── server.js                # Express 服务器 + API
├── plugin-loader.js         # 插件扫描/加载/数据
├── lib/
│   ├── core.js              # 配置读写、导出净化、DEFAULT_CONFIG
│   ├── media-store.js       # 媒体库远程条目存储
│   └── routes/              # 配置/插件/主题/导出/站点路由
├── data/                    # 运行数据（不入库，含密钥，别提交）
├── site/                    # 前端站点（Editorial 主题）
│   ├── css/editorial.css    # 全站样式
│   └── js/                  # cms.js 是前端运行时，core-modules.js 是内置模块
├── admin/                   # 管理后台
├── plugins/                 # 插件（见下）
├── themes/                  # 主题，用法见 themes/README.md
├── uploads/                 # 上传图片（不入库）
└── dist/                    # 导出的静态站（不入库）
```

## 插件

`plugins/` 下现在的成员，按用途分几类：

- **内容通道**：comment-gateway 和 contribute-gateway 负责把留言、投稿变成待审 Issue；github-issues 把审核通过的 Issue 固化进配置并自动导出推送；ai-review 用 MiMo 过一遍待审内容，能自动放行的就不放人工了
- **同步**：weibo-watch 和 xhs-gallery-sync 是知更的数据消费端，定时拉微博行程和小红书图集写进站点，本插件体系不做采集
- **基建**：cloudflare-r2 图片上传、github-deploy 推送
- **展示**：hero-pet 首页小宠物、hero-photo 首页粒子 hero（用法和坑见它自己的 README）

### 写一个新插件

目录结构：

```text
my-plugin/
├── manifest.json
├── client.js        # 前端（可选）
├── server.js        # 后端路由/钩子（可选）
├── admin.js         # 后台设置面板（可选）
└── assets/          # 静态资源（导出时复制）
```

manifest.json 声明基本信息，`inject: true` 表示 client.js 会被注入到每个页面：

```json
{
  "name": "my-plugin",
  "label": "我的插件",
  "version": "1.0.0",
  "description": "描述",
  "client": "client.js",
  "server": "server.js",
  "admin": "admin.js",
  "inject": true,
  "category": "display"
}
```

前端注册模块（返回 HTML 字符串，数据来自全局 SITE_CONFIG）：

```js
(function () {
  window.CMS.registerModule('hello', function (mod, idx) {
    var U = window.CMS.utils;
    return '<section class="section"><h2>' + U.esc(mod.text || 'Hello') + '</h2></section>';
  }, { nav: { href: '#hello', text: 'Hello' } });
})();
```

后端拿到的 ctx 里有 `app`（Express 实例）、`getData()/setData()`（插件独立数据）、`media`（媒体库）、`log` 等工具；`ctx.onExport` 可以挂导出钩子往 dist 里写东西。

后台面板用 `window.AdminCMS.registerPluginPanel(name, { label, render(data), collect() })`，render 返回表单 HTML，collect 返回要保存的对象。

几个踩过的坑，写在这里省得再踩一遍：

- 后台保存插件数据是**整体替换后浅合并**，面板的 collect() 必须收集全部字段，漏了就会把运行态数据（比如同步游标）抹掉；回显时空值要用 `data.x == null ? 默认 : data.x`，写 `|| 默认` 会把用户清空的配置又填回去
- 想让前端在**公共站**也能读到插件配置，插件名必须加进 `lib/core.js` 的 `EXPORTABLE_PLUGIN_DATA` 白名单（导出时会剥掉其余插件数据，这是防密钥泄漏的闸门）
- 注入的 client.js 运行在 head 里，而首页内容是 main.js 异步渲染的，等 `.hero` 这类节点要用轮询，别在脚本顶层就 querySelector

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| GET / PUT / PATCH | `/api/config` | 读配置 / 整包写入 / 分片深合并（后台默认用 PATCH） |
| POST | `/api/upload` | 上传图片到本地媒体库 |
| GET / DELETE | `/api/images` | 图片列表（本地 + 远程合并）与删除 |
| GET | `/api/plugins` | 插件列表 |
| POST | `/api/plugins/install` | ZIP 安装插件 |
| POST | `/api/plugins/:name/toggle` | 启停插件 |
| PUT | `/api/plugins/:name/data` | 保存插件数据 |
| GET / POST | `/api/themes` | 主题列表 / 上传 |
| POST | `/api/export` | 导出静态站到 dist/ |
| GET | `/api/export/download` | 下载导出 ZIP |
| POST | `/api/plugins/github-issues/check` | 检查已批准的 Issue |
| POST | `/api/plugins/github-deploy/push` | 推送 dist 到 GitHub |

## 最后

这个项目是跟着站子的需求长起来的，很多设计（比如 Issue 审核流、稳定 ID、图集懒加载）都是被实际问题逼出来的。改它的时候尽量小步走，改完在真实数据上过一遍再上线——历史教训都记在事故档案里了。

License: MIT
