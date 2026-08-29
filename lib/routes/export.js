/**
 * 静态导出路由
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

module.exports = function createExportRoutes(core) {
    const router = express.Router();
    const { PATHS, readConfig, sanitizeConfigForExport, generateConfigJs, copyDirSync } = core;

    // 静态导出只包含原始 HTML/JS/CSS，不导出插件资源
    router.post('/api/export', (req, res) => {
        try {
            // 清空 dist 目录内容，但保留挂载点本身（Docker volume 不能删除根目录）
            if (fs.existsSync(PATHS.DIST_DIR)) {
                for (const entry of fs.readdirSync(PATHS.DIST_DIR)) {
                    fs.rmSync(path.join(PATHS.DIST_DIR, entry), { recursive: true, force: true });
                }
            } else {
                fs.mkdirSync(PATHS.DIST_DIR, { recursive: true });
            }

            copyDirSync(PATHS.SITE_DIR, PATHS.DIST_DIR);

            const config = readConfig();
            // 写入 GitHub Issues 提交模板（优先使用后台自定义内容）
            const defaultReadme = require('../issue-readme');
            const readmeContent = config.exportReadme || defaultReadme;
            fs.writeFileSync(path.join(PATHS.DIST_DIR, 'README.md'), readmeContent);
            const jsDir = path.join(PATHS.DIST_DIR, 'js');
            fs.mkdirSync(jsDir, { recursive: true });
            fs.writeFileSync(path.join(jsDir, 'config.js'), generateConfigJs(sanitizeConfigForExport(config)), 'utf-8');

            if (config.hero && config.hero.image) {
                const indexPath = path.join(PATHS.DIST_DIR, 'index.html');
                if (fs.existsSync(indexPath)) {
                    let html = fs.readFileSync(indexPath, 'utf-8');
                    const preload = `<link rel="preload" as="image" href="${config.hero.image}">`;
                    html = html.replace('</head>', `    ${preload}\n</head>`);
                    fs.writeFileSync(indexPath, html, 'utf-8');
                }
            }

            if (fs.existsSync(PATHS.UPLOADS_DIR) && fs.readdirSync(PATHS.UPLOADS_DIR).length) {
                copyDirSync(PATHS.UPLOADS_DIR, path.join(PATHS.DIST_DIR, 'uploads'));
            }

            if (config.theme && config.theme.active) {
                const themePath = path.join(PATHS.THEMES_DIR, config.theme.active);
                if (fs.existsSync(themePath)) copyDirSync(themePath, PATHS.DIST_DIR);
            }

            // 调用已加载插件的 onExport 钩子
            for (const p of req.app.locals.loadedPlugins || []) {
                if (typeof p.ctx.onExport === 'function') {
                    try { p.ctx.onExport(PATHS.DIST_DIR); } catch (e) {
                        console.error('[export] plugin hook error', p.name, e);
                    }
                }
            }

            res.json({ success: true, path: PATHS.DIST_DIR });
        } catch (err) {
            res.status(500).json({ error: 'Export failed: ' + err.message });
        }
    });

    router.get('/api/export/download', (req, res) => {
        if (!fs.existsSync(PATHS.DIST_DIR)) {
            return res.status(404).json({ error: 'Export not found. Run export first.' });
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=actor-home.zip');
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', err => {
            if (!res.headersSent) res.status(500).json({ error: err.message });
        });
        archive.pipe(res);
        archive.directory(PATHS.DIST_DIR, false);
        archive.finalize();
    });

    return router;
};
