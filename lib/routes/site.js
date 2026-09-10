/**
 * 站点动态路由与静态文件
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function createSiteRoutes(core) {
    const router = express.Router();
    const { PATHS, readConfig, sanitizeConfigForExport, generateConfigJs, injectPluginClientTags, generateGalleryJs, stripGallery } = core;

    const MIMES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
                    '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff' };

    // 发送文件：HTML 注入已启用插件的 client 脚本（NAS 实时站；公共站由导出注入）
    function sendFile(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        res.set('Content-Type', MIMES[ext] || 'application/octet-stream');
        res.set('Cache-Control', 'no-cache');
        const buf = fs.readFileSync(filePath);
        res.send(ext === '.html' ? injectPluginClientTags(buf.toString('utf-8')) : buf);
    }

    router.get('/js/config.js', (req, res) => {
        try {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-cache');
            // 主 config 剥离 gallery.albums（体量最大）：图集数据独立为 data-gallery.js，按需懒加载
            res.send(generateConfigJs(stripGallery(sanitizeConfigForExport(readConfig()))));
        } catch (err) {
            res.status(500).send('// Error loading config');
        }
    });

    // 图集数据（独立、可缓存）：仅图集页与用到图集数据的页面懒加载
    router.get('/js/data-gallery.js', (req, res) => {
        try {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-cache');
            const cfg = sanitizeConfigForExport(readConfig());
            res.send(generateGalleryJs({ gallery: cfg.gallery }));
        } catch (err) {
            res.status(500).send('// Error loading gallery');
        }
    });

    // 激活主题优先；site/ 下的 HTML 也在此返回（以便注入插件 client），其余静态交给下方 express.static
    router.use((req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/admin') || req.path.startsWith('/plugins')) return next();
        try {
            const config = readConfig();
            const themeName = config.theme && config.theme.active;
            if (themeName) {
                const themePath = path.join(PATHS.THEMES_DIR, themeName);
                const filePath = path.join(themePath, req.path === '/' ? 'index.html' : req.path);
                if (filePath.startsWith(themePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    return sendFile(res, filePath);
                }
            }
            const siteFile = path.join(PATHS.SITE_DIR, req.path === '/' ? 'index.html' : req.path);
            if (/\.html?$/i.test(siteFile) && siteFile.startsWith(PATHS.SITE_DIR)
                && fs.existsSync(siteFile) && fs.statSync(siteFile).isFile()) {
                return sendFile(res, siteFile);
            }
        } catch (e) { /* ignore */ }
        next();
    });

    router.get('/admin', (req, res) => {
        res.set('Content-Type', 'text/html');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(fs.readFileSync(path.join(PATHS.ADMIN_DIR, 'index.html')));
    });

    // HTML 页面不缓存
    router.use((req, res, next) => {
        if (req.path === '/' || req.path.endsWith('.html')) {
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
        }
        next();
    });

    router.use(express.static(PATHS.SITE_DIR, {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        }
    }));

    return router;
};
