/**
 * 站点评论路由
 * 访客提交：POST /api/comments（同源；NAS/CMS 端点。公共静态站的提交端由 comment-gateway 插件生成）
 * 后台管理：GET /api/comments/admin（全部评论）、POST /api/comments/settings（一键开关）、DELETE /api/comments/admin/:page/:id
 * 数据：config.comments[展示键] = [{ id, n(昵称), t(内容), d(日期), replyTo? }]
 *       开关：config.commentSettings.enabled（缺省开启；独立于后台全局保存，避免同状态多入口覆盖）
 */
const express = require('express');

function commentsEnabled(config) {
    return !(config.commentSettings && config.commentSettings.enabled === false);
}

/** 展示键 → 友好名称（解析相册/作品标题，解析不到回退原始键） */
function describePage(config, key) {
    if (key === 'news') return { key, label: '最新动态' };
    let m = key.match(/^album-([A-Za-z0-9_-]{1,32})$/);
    if (m) {
        const album = ((config.gallery && config.gallery.albums) || []).find(a => a.id === m[1]);
        return { key, label: album && album.title ? `写真集「${album.title}」` : `写真集 ${m[1]}` };
    }
    m = key.match(/^work-([A-Za-z0-9_-]{1,32})$/);
    if (m) {
        for (const cat of (config.works && config.works.categories) || []) {
            const hit = (cat.items || []).find(x => x.id === m[1]);
            if (hit) return { key, label: `作品「${hit.title || m[1]}」` };
        }
        return { key, label: `作品 ${m[1]}` };
    }
    return { key, label: key };
}

module.exports = function createCommentsRoutes(core) {
    const router = express.Router();

    router.post('/api/comments', (req, res) => {
        try {
            const config = core.readConfig();
            if (!commentsEnabled(config)) {
                return res.status(403).json({ error: '评论功能已关闭' });
            }
            const b = req.body || {};
            const page = String(b.page || '').trim().slice(0, 40);
            const content = String(b.content || '').trim().slice(0, 500);
            if (!page || !content) return res.status(400).json({ error: '页面或内容缺失' });
            config.comments = config.comments || {};
            config.comments[page] = config.comments[page] || [];
            const entry = {
                id: 'c-' + Date.now().toString(36),
                n: String(b.nickname || '').trim().slice(0, 20) || '马铃薯',
                t: content,
                d: new Date().toISOString().slice(0, 10)
            };
            const replyTo = String(b.replyTo || '').trim().slice(0, 24);
            if (replyTo) entry.replyTo = replyTo;
            config.comments[page].push(entry);
            core.writeConfig(config);
            res.json({ success: true, comment: entry });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 后台：全部评论 + 开关状态（键按配置顺序，评论按原有顺序）
    router.get('/api/comments/admin', (req, res) => {
        try {
            const config = core.readConfig();
            const pages = [];
            for (const [key, list] of Object.entries(config.comments || {})) {
                if (!Array.isArray(list)) continue;
                pages.push({ ...describePage(config, key), count: list.length, comments: list });
            }
            res.json({ settings: { enabled: commentsEnabled(config) }, pages });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 后台：一键启用/关闭评论功能（即时端点，不走全局保存）
    router.post('/api/comments/settings', (req, res) => {
        try {
            const b = req.body || {};
            if (typeof b.enabled !== 'boolean') {
                return res.status(400).json({ error: 'enabled 必须为布尔值' });
            }
            const config = core.readConfig();
            config.commentSettings = { ...(config.commentSettings || {}), enabled: b.enabled };
            core.writeConfig(config);
            res.json({ success: true, settings: { enabled: b.enabled } });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 后台：删除单条评论（其下回复上移为一级评论；页键清空后移除）
    router.delete('/api/comments/admin/:page/:id', (req, res) => {
        try {
            const page = String(req.params.page || '').slice(0, 40);
            const id = String(req.params.id || '').slice(0, 24);
            if (!page || !id) return res.status(400).json({ error: '参数缺失' });
            const config = core.readConfig();
            const list = config.comments && config.comments[page];
            if (!Array.isArray(list)) return res.status(404).json({ error: '页面不存在' });
            const idx = list.findIndex(c => c && c.id === id);
            if (idx < 0) return res.status(404).json({ error: '评论不存在' });
            list.splice(idx, 1);
            if (!list.length) delete config.comments[page];
            core.writeConfig(config);
            res.json({ success: true, remaining: list.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
