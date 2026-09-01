/**
 * Actor Home CMS — 后端入口
 * 路由拆分为 lib/routes/*，核心工具在 lib/core.js
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
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

/* ---------- 每日自动备份配置（内置） ----------
 * 每天一份 data/backups/config-YYYY-MM-DD.json；同一天不重复写；保留最近 14 份。
 */
const BACKUP_KEEP = 14;
function dailyConfigBackup() {
    try {
        const dir = path.join(PATHS.DATA_DIR, 'backups');
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(PATHS.CONFIG_PATH)) return;
        const today = new Date().toISOString().slice(0, 10);
        const dst = path.join(dir, 'config-' + today + '.json');
        if (fs.existsSync(dst)) return; // 当天已有备份
        fs.copyFileSync(PATHS.CONFIG_PATH, dst);
        const files = fs.readdirSync(dir)
            .filter(f => /^config-\d{4}-\d{2}-\d{2}\.json$/.test(f))
            .sort();
        while (files.length > BACKUP_KEEP) {
            fs.unlinkSync(path.join(dir, files.shift()));
        }
        console.log('[backup] 配置已备份至', dst);
    } catch (e) {
        console.error('[backup] 失败:', e.message);
    }
}
dailyConfigBackup();
setInterval(dailyConfigBackup, 12 * 60 * 60 * 1000).unref(); // 每 12h 检查一次（当天已备份则跳过）

app.listen(PORT, () => {
    console.log('\n  Actor Home CMS');
    console.log('  ────────────────');
    console.log(`  Frontend:  http://localhost:${PORT}`);
    console.log(`  Admin:     http://localhost:${PORT}/admin`);
    console.log('  ────────────────\n');
});
