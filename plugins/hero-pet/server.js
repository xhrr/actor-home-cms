/**
 * 首页 Q 版宠物：纯前端插件（无后端逻辑）。
 * 保留 server.js 以符合插件结构；此处仅提供只读状态端点便于排查。
 */
module.exports = function (ctx) {
    ctx.app.get('/api/plugins/hero-pet/status', (req, res) => {
        res.json({ ok: true, data: ctx.getData() });
    });
};
