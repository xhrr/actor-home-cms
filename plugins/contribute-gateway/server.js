/**
 * 投稿网关（公共站投稿提交端）
 * 独立插件，与 comment-gateway / github-issues 零代码耦合：
 *   本插件生成的 Function：收投稿表单（字段+图片）→ 图片经 R2 binding 直传 → 建 GitHub Issue（待审标签）
 *   github-issues 老插件：轮询 approved Issue → 固化进 config → 自动导出部署
 * 页面：site/contribute.html（随导出部署到公共站）
 */
const fs = require('fs');
const path = require('path');
const core = require('../../lib/core');

const DEFAULTS = {
    repo: 'xhrr/QMQ-SGLXQ',
    label: 'content-pending',
    publicBase: 'img.sglxq.cn',
    keyPrefix: 'img/mqq'
};

// Function 实际使用的是 Pages 环境变量 GITHUB_TOKEN 与 R2 binding BUCKET；
// 这里检测复用 github-issues 插件的共用 Token，避免同一 Token 存两份
function sharedToken() {
    const config = core.readConfig();
    const data = (config.plugins && config.plugins.data) || {};
    return String((data['github-issues'] && data['github-issues'].token) || '').trim();
}

module.exports = function (ctx) {
    const cfg = () => ({ ...DEFAULTS, ...(ctx.getData() || {}) });

    ctx.app.get('/api/plugins/contribute-gateway/status', (req, res) => {
        res.json(cfg());
    });

    // 校验共用 Token 对目标仓库的权限（只读检查，不建 Issue）
    ctx.app.post('/api/plugins/contribute-gateway/check', async (req, res) => {
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
                : `仓库 ${j.full_name} 可达，但 Token 无 push 权限 ❌`;
            ctx.setData({ ...d, lastCheck: new Date().toISOString(), lastStatus: message });
            res.json({ ok: true, repo: j.full_name, push, message });
        } catch (e) {
            const message = '检查失败：' + e.message;
            ctx.setData({ ...d, lastCheck: new Date().toISOString(), lastStatus: message });
            res.status(502).json({ error: message });
        }
    });

    // 导出钩子：Function 写进 dist/functions/api/contribute.js（推送后 Pages 自动识别 functions/）
    ctx.onExport = distDir => {
        const d = cfg();
        let src = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf-8');
        src = src.split('__ISSUES_REPO__').join(d.repo)
            .split('__PENDING_LABEL__').join(d.label)
            .split('__PUBLIC_BASE__').join(d.publicBase)
            .split('__KEY_PREFIX__').join(d.keyPrefix);
        const target = path.join(distDir, 'functions', 'api', 'contribute.js');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, src, 'utf-8');
        ctx.log(`已生成投稿端 Function → dist/functions/api/contribute.js（repo=${d.repo}, label=${d.label}）`);
    };
};
