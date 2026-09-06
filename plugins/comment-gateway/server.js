/**
 * 评论提交网关（公共站评论提交端）
 * 公共静态站没有 CMS 后端，本插件在导出时把 Pages Function（worker.js）生成到
 * dist/functions/api/comments.js，随内容仓库推送自动部署到 Cloudflare Pages。
 *
 * 流水线分工（本插件不参与固化，与 github-issues 无代码耦合）：
 *   本插件生成的 Function：收公共站表单 → 校验 → 建 GitHub Issue（待审标签）
 *   github-issues 老插件：轮询 approved Issue → 固化进 config → 自动导出推送
 */
const fs = require('fs');
const path = require('path');
const core = require('../../lib/core');

const DEFAULTS = { repo: 'xhrr/QMQ-SGLXQ', label: 'comment-pending' };

// Function 实际使用的是 Pages 环境变量里的 GITHUB_TOKEN（站长在 CF 后台配置）；
// 这里的检测复用 github-issues 插件的共用 Token，避免同一 Token 存两份
function sharedToken() {
    const config = core.readConfig();
    const data = (config.plugins && config.plugins.data) || {};
    return String((data['github-issues'] && data['github-issues'].token) || '').trim();
}

module.exports = function (ctx) {
    const cfg = () => ({ ...DEFAULTS, ...(ctx.getData() || {}) });

    ctx.app.get('/api/plugins/comment-gateway/status', (req, res) => {
        res.json(cfg());
    });

    // 校验共用 Token 对目标仓库的权限（只读检查，不建任何 Issue）
    ctx.app.post('/api/plugins/comment-gateway/check', async (req, res) => {
        const d = cfg();
        const token = sharedToken();
        if (!token) {
            return res.status(400).json({ error: '未找到 GitHub Token：先在「GitHub Issues 内容更新」插件里保存' });
        }
        try {
            const r = await fetch(`https://api.github.com/repos/${d.repo}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Actor-CMS'
                }
            });
            if (!r.ok) throw new Error(`GitHub API ${r.status}`);
            const j = await r.json();
            const push = !!(j.permissions && j.permissions.push);
            const message = push
                ? `仓库 ${j.full_name} 可达，Token 具备建 Issue/打标签权限 ✅`
                : `仓库 ${j.full_name} 可达，但 Token 无 push 权限，无法打待审标签 ❌`;
            ctx.setData({ ...d, lastCheck: new Date().toISOString(), lastStatus: message });
            res.json({ ok: true, repo: j.full_name, push, private: !!j.private, message });
        } catch (e) {
            const message = '检查失败：' + e.message;
            ctx.setData({ ...d, lastCheck: new Date().toISOString(), lastStatus: message });
            res.status(502).json({ error: message });
        }
    });

    // 导出钩子：Function 写进 dist/functions/api/comments.js（推送脚本全量上送 dist，Pages 自动识别 functions/）
    ctx.onExport = distDir => {
        const d = cfg();
        // 评论功能一键开关（后台「评论管理」）：关闭时注入 ENABLED=false，公共站提交端随部署一并关闭
        const config = core.readConfig();
        const enabled = !(config.commentSettings && config.commentSettings.enabled === false);
        let src = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf-8');
        src = src.replace('__ISSUES_REPO__', d.repo)
            .replace('__PENDING_LABEL__', d.label)
            .replace('__COMMENTS_ENABLED__', enabled ? 'true' : 'false');
        const target = path.join(distDir, 'functions', 'api', 'comments.js');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, src, 'utf-8');
        ctx.log(`已生成提交端 Function → dist/functions/api/comments.js（repo=${d.repo}, label=${d.label}, enabled=${enabled}）`);
    };
};
