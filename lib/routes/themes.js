/**
 * 主题管理路由
 */
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

module.exports = function createThemeRoutes(core) {
    const router = express.Router();
    const { PATHS, readConfig, writeConfig } = core;

    const zipUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 },
        fileFilter: (req, file, cb) => cb(null, file.originalname.toLowerCase().endsWith('.zip'))
    });

    router.get('/api/themes', (req, res) => {
        try {
            const config = readConfig();
            const themes = [];
            if (fs.existsSync(PATHS.THEMES_DIR)) {
                for (const name of fs.readdirSync(PATHS.THEMES_DIR)) {
                    const themePath = path.join(PATHS.THEMES_DIR, name);
                    if (!fs.statSync(themePath).isDirectory()) continue;
                    const metaPath = path.join(themePath, 'theme.json');
                    let meta = null;
                    if (fs.existsSync(metaPath)) {
                        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) {}
                    }
                    themes.push({
                        name,
                        label: (meta && meta.label) || name,
                        description: (meta && meta.description) || '',
                        hasHtml: fs.existsSync(path.join(themePath, 'index.html')),
                        hasCss: fs.existsSync(path.join(themePath, 'css'))
                    });
                }
            }
            res.json({ themes, active: (config.theme && config.theme.active) || null });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/themes/upload', zipUpload.single('theme'), (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const zip = new AdmZip(req.file.buffer);
            const themeName = req.file.originalname.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9_\\-]/g, '_');
            const themePath = path.join(PATHS.THEMES_DIR, themeName);
            if (fs.existsSync(themePath)) return res.status(409).json({ error: 'Theme already exists' });
            zip.extractAllTo(themePath, true);

            const hasHtml = fs.existsSync(path.join(themePath, 'index.html'));
            const hasCss = fs.existsSync(path.join(themePath, 'css'));
            if (!hasHtml && !hasCss) {
                fs.rmSync(themePath, { recursive: true, force: true });
                return res.status(400).json({ error: 'ZIP must contain index.html or css/ directory' });
            }
            res.json({ success: true, name: themeName, hasHtml, hasCss });
        } catch (err) {
            res.status(500).json({ error: 'Theme upload failed: ' + err.message });
        }
    });

    router.post('/api/themes/:name/activate', (req, res) => {
        try {
            const config = readConfig();
            config.theme.active = req.params.name === '__default__' ? null : req.params.name;
            writeConfig(config);
            res.json({ success: true, active: config.theme.active });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
