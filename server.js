/**
 * Actor Home CMS — 后端入口
 * 路由拆分为 lib/routes/*，核心工具在 lib/core.js
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const core = require('./lib/core');
const pluginLoader = require('./plugin-loader');

const app = express();
const PORT = process.env.PORT || 3000;
const { PATHS } = core;

core.ensureDirs();

/* ---------- 传输压缩（内置 zlib，零依赖） ----------
 * NAS 直连不做压缩，config.js / data-gallery.js / editorial.css / vendor 等文本资源裸传，
 * 图集扩容后可达数百 KB。此处按 Accept-Encoding 压缩可压缩类型（br 优先，其次 gzip）。
 * 实现方式：拦截 res.write/res.end —— 这样动态路由（res.send）与 express.static 的静态文件都能覆盖。
 * 只缓冲「可压缩类型」的响应；图片/视频等二进制类型一旦识别即转为直通，不做缓冲。
 */
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|x-www-form-urlencoded|x-javascript)|image\/svg)/i;
const COMPRESS_MIN = 1024;            // 小于 1KB 不压，收益不抵开销
const COMPRESS_MAX = 8 * 1024 * 1024; // 超过 8MB 不缓冲，避免占用内存

function compressMiddleware(req, res, next) {
    const ae = String(req.headers['accept-encoding'] || '');
    const useBr = /\bbr\b/.test(ae);
    const useGzip = /\bgzip\b/.test(ae);
    if (!useBr && !useGzip) return next();
    if (req.method === 'HEAD') return next();

    const origWrite = res.write;
    const origEnd = res.end;
    let state = 'undecided';  // undecided | buffering | passthrough
    let chunks = [];

    const isCompressible = () => {
        const ct = String(res.getHeader('Content-Type') || '');
        if (!COMPRESSIBLE.test(ct)) return false;
        if (res.getHeader('Content-Encoding')) return false;      // 已压缩（如预压资源）
        const len = parseInt(res.getHeader('Content-Length') || '0', 10);
        if (len && len < COMPRESS_MIN) return false;
        if (len && len > COMPRESS_MAX) return false;
        if (res.getHeader('Content-Disposition')) return false;   // 下载不走压缩
        return true;
    };

    const toBuf = (chunk, enc) => Buffer.isBuffer(chunk) ? chunk
        : chunk instanceof Uint8Array ? Buffer.from(chunk)
        : Buffer.from(String(chunk), typeof enc === 'string' ? enc : 'utf8');

    res.write = function (chunk, enc, cb) {
        if (state === 'passthrough') return origWrite.call(this, chunk, enc, cb);
        if (state === 'undecided') {
            if (!isCompressible()) { state = 'passthrough'; return origWrite.call(this, chunk, enc, cb); }
            state = 'buffering';
        }
        if (chunk != null) chunks.push(toBuf(chunk, enc));
        if (typeof cb === 'function') cb();
        return true;
    };

    res.end = function (chunk, enc, cb) {
        if (state === 'passthrough') return origEnd.call(this, chunk, enc, cb);
        if (state === 'undecided') {
            if (!isCompressible()) { state = 'passthrough'; return origEnd.call(this, chunk, enc, cb); }
            state = 'buffering';
        }
        if (chunk != null) chunks.push(toBuf(chunk, enc));
        const buf = Buffer.concat(chunks);
        chunks = null;
        if (buf.length < COMPRESS_MIN) return origEnd.call(this, buf, cb);
        let out = null, cenc = null;
        if (useBr) { try { out = zlib.brotliCompressSync(buf); cenc = 'br'; } catch (e) { /* 回退 gzip */ } }
        if (!out && useGzip) { try { out = zlib.gzipSync(buf); cenc = 'gzip'; } catch (e) { /* 原样 */ } }
        if (!out) return origEnd.call(this, buf, cb);
        this.setHeader('Content-Encoding', cenc);
        this.setHeader('Vary', 'Accept-Encoding');
        this.setHeader('Content-Length', out.length);
        return origEnd.call(this, out, cb);
    };
    next();
}
app.use(compressMiddleware);

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
app.use(require('./lib/routes/comments')(core));
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
