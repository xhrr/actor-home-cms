module.exports = function (ctx) {
    // 演示后端插件注册路由
    ctx.app.get('/api/plugins/hello-world/ping', (req, res) => {
        res.json({ pong: true, plugin: ctx.plugin, data: ctx.getData() });
    });
};
