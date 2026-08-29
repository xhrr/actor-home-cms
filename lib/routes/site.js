/**
 * 站点动态路由与静态文件
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function createSiteRoutes(core) {
    const router = express.Router();
    const { PATHS, readConfig, sanitizeConfigForExport, generateConfigJs } = core;

    router.get('/js/config.js', (req, res) => {
        try {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-cache');
            res.send(generateConfigJs(sanitizeConfigForExport(readConfig())));
        } catch (err) {
            res.status(500).send('// Error loading config');
        }
    });

    // 激活主题优先
    router.use((req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/admin') || req.path.startsWith('/plugins')) return next();
        try {
            const config = readConfig();
            const themeName = config.theme && config.theme.active;
            if (!themeName) return next();
            const themePath = path.join(PATHS.THEMES_DIR, themeName);
            const filePath = path.join(themePath, req.path === '/' ? 'index.html' : req.path);
            if (filePath.startsWith(themePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const ext = path.extname(filePath).toLowerCase();
                const mimes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
                                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                                '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
                                '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
                res.set('Content-Type', mimes[ext] || 'application/octet-stream');
                res.set('Cache-Control', 'no-cache');
                return res.send(fs.readFileSync(filePath));
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
