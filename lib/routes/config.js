/**
 * 配置与媒体路由
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mediaStore = require('../media-store');

module.exports = function createConfigRoutes(core) {
    const router = express.Router();
    const { PATHS, readConfig, writeConfig } = core;
    const UPLOADS_DIR = PATHS.UPLOADS_DIR;

    // 图片上传
    const imageUpload = multer({
        storage: multer.diskStorage({
            destination: UPLOADS_DIR,
            filename: (req, file, cb) => {
                const ext = path.extname(file.originalname).toLowerCase();
                cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
            }
        }),
        fileFilter: (req, file, cb) => {
            const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            cb(null, allowed.includes(file.mimetype));
        }
    });

    // JSON 配置导入
    const jsonUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter: (req, file, cb) => cb(null, file.originalname.toLowerCase().endsWith('.json'))
    });

    router.get('/api/config', (req, res) => {
        try {
            res.json(readConfig());
        } catch (err) {
            res.status(500).json({ error: 'Failed to read config: ' + err.message });
        }
    });

    router.put('/api/config', (req, res) => {
        try {
            const config = req.body;
            if (!config.actor) return res.status(400).json({ error: 'Missing actor field' });
            writeConfig(config);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to save config: ' + err.message });
        }
    });

    router.post('/api/config/import', jsonUpload.single('config'), (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            let imported;
            try {
                imported = JSON.parse(req.file.buffer.toString('utf-8'));
            } catch (e) {
                return res.status(400).json({ error: 'Invalid JSON' });
            }
            if (!imported.actor && !imported.photographer) {
                return res.status(400).json({ error: 'Missing actor field' });
            }
            writeConfig(imported);
            res.json({ success: true, message: '配置导入成功' });
        } catch (err) {
            res.status(500).json({ error: 'Import failed: ' + err.message });
        }
    });

    router.post('/api/upload', imageUpload.single('image'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded or invalid type' });
        res.json({ url: '/uploads/' + req.file.filename });
    });

    router.get('/api/images', (req, res) => {
        try {
            const files = fs.readdirSync(UPLOADS_DIR).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
            const local = files.map(f => ({
                filename: f,
                url: '/uploads/' + f,
                size: fs.statSync(path.join(UPLOADS_DIR, f)).size,
                remote: false
            }));
            const remote = mediaStore.listRemote().map(r => Object.assign({}, r, { remote: true }));
            res.json(local.concat(remote));
        } catch (err) {
            res.status(500).json({ error: 'Failed to list images' });
        }
    });

    router.delete('/api/images/:filename', (req, res) => {
        try {
            const filePath = path.join(UPLOADS_DIR, path.basename(req.params.filename));
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
            fs.unlinkSync(filePath);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete' });
        }
    });

    // 删除远程媒体条目（仅从媒体库移除，不影响 R2 桶内对象）
    router.delete('/api/images/remote/:id', (req, res) => {
        try {
            if (!mediaStore.removeRemote(req.params.id)) {
                return res.status(404).json({ error: 'Remote media not found' });
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete: ' + err.message });
        }
    });

    // README 编辑
    const defaultReadme = require('../issue-readme');

    router.get('/api/readme', (req, res) => {
        try {
            const config = readConfig();
            res.json({ content: config.exportReadme || defaultReadme });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/api/readme', (req, res) => {
        try {
            const content = req.body && req.body.content;
            if (typeof content !== 'string') return res.status(400).json({ error: 'content is required' });
            const config = readConfig();
            config.exportReadme = content;
            writeConfig(config);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
