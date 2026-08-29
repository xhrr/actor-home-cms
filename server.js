/**
 * Actor Home CMS — 后端入口
 * 路由拆分为 lib/routes/*，核心工具在 lib/core.js
 */
const express = require('express');
const path = require('path');
const core = require('./lib/core');
const pluginLoader = require('./plugin-loader');

const app = express();
const PORT = process.env.PORT || 3000;
const { PATHS } = core;

core.ensureDirs();

/* ---------- 基础中间件与静态资源 ---------- */
app.use(express.json({ limit: '20mb' }));
app.use('/admin/css', express.static(path.join(PATHS.ADMIN_DIR, 'css')));
app.use('/admin/js', express.static(path.join(PATHS.ADMIN_DIR, 'js')));
app.use('/uploads', express.static(PATHS.UPLOADS_DIR, { maxAge: '1d' }));
app.use('/plugins', express.static(PATHS.PLUGINS_DIR, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

/* ---------- API 路由 ---------- */
app.use(require('./lib/routes/config')(core));
app.use(require('./lib/routes/plugins')(core));
app.use(require('./lib/routes/themes')(core));
app.use(require('./lib/routes/export')(core));

/* ---------- 站点路由（含动态 config.js 与主题覆盖） ---------- */
app.use(require('./lib/routes/site')(core));

/* ---------- 错误处理 ---------- */
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

/* ---------- 启动 ---------- */
app.locals.loadedPlugins = pluginLoader.loadEnabledPlugins(app);

app.listen(PORT, () => {
    console.log('\n  Actor Home CMS');
    console.log('  ────────────────');
    console.log(`  Frontend:  http://localhost:${PORT}`);
    console.log(`  Admin:     http://localhost:${PORT}/admin`);
    console.log('  ────────────────\n');
});
