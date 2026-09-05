/**
 * 插件管理路由
 */
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const pluginLoader = require('../../plugin-loader');

module.exports = function createPluginRoutes(core) {
    const router = express.Router();
    const { PATHS, readConfig, writeConfig } = core;

    const zipUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 },
        fileFilter: (req, file, cb) => cb(null, file.originalname.toLowerCase().endsWith('.zip'))
    });

    router.get('/api/plugins', (req, res) => {
        try {
            res.json({ plugins: pluginLoader.scanPlugins() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/plugins/install', zipUpload.single('plugin'), (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const zip = new AdmZip(req.file.buffer);
            const entries = zip.getEntries();
            // manifest 允许两种打包：一层子文件夹内（常用），或 zip 根目录平铺；同时存在时优先子文件夹
            const manifestEntry = entries.find(e => !e.isDirectory && e.entryName.replace(/\\/g, '/').endsWith('/manifest.json'))
                || entries.find(e => !e.isDirectory && e.entryName.replace(/\\/g, '/') === 'manifest.json');
            if (!manifestEntry) return res.status(400).json({ error: 'ZIP must contain a manifest.json' });

            const normalized = manifestEntry.entryName.replace(/\\/g, '/');
            const parts = normalized.split('/');
            const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
            const pluginName = (manifest.name || parts[0] || req.file.originalname).replace(/[^a-zA-Z0-9_\\-]/g, '_');
            const destPath = path.join(PATHS.PLUGINS_DIR, pluginName);

            if (fs.existsSync(destPath)) return res.status(409).json({ error: 'Plugin already exists: ' + pluginName });
            fs.mkdirSync(destPath, { recursive: true });

            const prefix = parts.length >= 2 && parts[0] !== '' && parts[0] !== '.' ? parts[0] + '/' : '';
            for (const entry of entries) {
                if (entry.isDirectory) continue;
                let entryPath = entry.entryName.replace(/\\/g, '/');
                if (prefix && entryPath.startsWith(prefix)) entryPath = entryPath.slice(prefix.length);
                if (!entryPath) continue;
                const safePath = path.join(destPath, entryPath);
                if (!safePath.startsWith(destPath)) continue;
                fs.mkdirSync(path.dirname(safePath), { recursive: true });
                fs.writeFileSync(safePath, entry.getData());
            }

            const installedManifest = path.join(destPath, 'manifest.json');
            if (!fs.existsSync(installedManifest)) {
                fs.rmSync(destPath, { recursive: true, force: true });
                return res.status(400).json({ error: 'Installed plugin missing manifest.json' });
            }

            const state = pluginLoader.getState();
            if (!state.installed.includes(pluginName)) state.installed.push(pluginName);
            pluginLoader.saveState(state);
            res.json({ success: true, name: pluginName });
        } catch (err) {
            res.status(500).json({ error: 'Install failed: ' + err.message });
        }
    });

    router.post('/api/plugins/:name/toggle', (req, res) => {
        try {
            const name = req.params.name;
            const plugin = pluginLoader.scanPlugins().find(p => p.name === name);
            if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
            pluginLoader.setEnabled(name, !plugin.enabled);

            const config = readConfig();
            config.plugins.enabled = pluginLoader.getState().enabled.slice();
            writeConfig(config);

            // 动态加载/卸载插件后端路由，无需重启
            req.app.locals.loadedPlugins = pluginLoader.loadEnabledPlugins(req.app);

            res.json({ success: true, enabled: pluginLoader.getState().enabled.includes(name) });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/api/plugins/:name/data', (req, res) => {
        try {
            const data = pluginLoader.setPluginData(req.params.name, req.body || {});
            res.json({ success: true, data });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/api/plugins/:name', (req, res) => {
        try {
            const name = req.params.name;
            pluginLoader.removePlugin(name);
            const config = readConfig();
            config.plugins.enabled = pluginLoader.getState().enabled.slice();
            writeConfig(config);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
