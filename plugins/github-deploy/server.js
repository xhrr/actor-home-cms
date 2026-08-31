/**
 * GitHub 部署插件（Git Data API 版）
 * 将 dist/ 推送到 GitHub 仓库（api.github.com），绕过 github.com 直连限制。
 * 流程：blob → tree（全量定义最终文件树，删除即自动清理）→ commit（parent=远端 HEAD）→ 更新 ref（fast-forward）。
 */
const fs = require('fs');
const path = require('path');

/* ---------------- repo 简写统一 ---------------- */
function normalizeRepo(repo) {
    let r = String(repo || '').trim().replace(/\.git$/, '');
    r = r.replace(/^https?:\/\/github\.com\//i, '');
    r = r.replace(/^git:\/\/github\.com\//i, '');
    r = r.replace(/^git@github\.com:/i, '');
    r = r.replace(/\/+$/, '');
    return r;
}

/* ---------------- dist 文件清单 ---------------- */
function walkDir(root, dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkDir(root, full));
        } else {
            out.push({ path: path.relative(root, full).split(path.sep).join('/'), file: full });
        }
    }
    return out;
}

module.exports = function (ctx) {
    const DIST_DIR = path.join(__dirname, '..', '..', 'dist');

    async function gh(token, url, method, body) {
        const res = await fetch('https://api.github.com' + url, {
            method: method || 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Actor-CMS',
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`GitHub API ${res.status} ${url}: ${text.slice(0, 300)}`);
        return text ? JSON.parse(text) : null;
    }

    ctx.app.post('/api/plugins/github-deploy/push', async (req, res) => {
        try {
            const config = ctx.getData();
            const repo = normalizeRepo(config.repo);
            const branch = (config.branch || 'main').trim();
            const token = (config.token || '').trim();

            if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
                return res.status(400).json({ error: '请先在插件配置中填写 GitHub 仓库（owner/repo 或完整 URL）' });
            }
            if (!token) {
                return res.status(400).json({ error: '请先在插件配置中填写 GitHub Token' });
            }
            if (!fs.existsSync(DIST_DIR) || fs.readdirSync(DIST_DIR).length === 0) {
                return res.status(400).json({ error: 'dist 不存在，请先在后台执行「导出到 dist/」' });
            }

            // 1. 远端分支当前 HEAD（fast-forward 的 parent）
            let parentSha = null;
            try {
                const ref = await gh(token, `/repos/${repo}/git/ref/heads/${branch}`);
                parentSha = ref.object.sha;
            } catch (e) {
                if (e.message.includes('404')) parentSha = null; // 分支不存在 → 首次部署（孤儿 commit）
                else throw e;
            }

            // 2. dist 文件清单 + blob（base64，内容寻址幂等）
            const files = walkDir(DIST_DIR, DIST_DIR);
            if (!files.length) {
                return res.status(400).json({ error: 'dist 为空，无法推送' });
            }
            const blobCache = new Map();
            const entries = [];
            for (const f of files) {
                const b64 = fs.readFileSync(f.file).toString('base64');
                let sha = blobCache.get(b64);
                if (!sha) {
                    const r = await gh(token, `/repos/${repo}/git/blobs`, 'POST', { content: b64, encoding: 'base64' });
                    sha = r.sha;
                    blobCache.set(b64, sha);
                }
                entries.push({ path: f.path, mode: '100644', type: 'blob', sha });
            }

            // 3. 全量 tree（无 base_tree → 以本次清单为准，远端多余文件一并清理）
            const tree = await gh(token, `/repos/${repo}/git/trees`, 'POST', { tree: entries });

            // 4. commit（parent = 远端 HEAD；无 parent 即孤儿 commit，用于首次/分支重建）
            const now = new Date().toISOString();
            const author = { name: 'Actor CMS', email: 'actor@localhost', date: now };
            const commit = await gh(token, `/repos/${repo}/git/commits`, 'POST', {
                message: `deploy: ${now}`,
                tree: tree.sha,
                parents: parentSha ? [parentSha] : [],
                author,
                committer: author
            });

            // 5. 更新分支 ref（fast-forward；分支不存在则新建）
            if (parentSha) {
                await gh(token, `/repos/${repo}/git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
            } else {
                await gh(token, `/repos/${repo}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
            }

            res.json({
                success: true,
                message: `已推送到 ${repo} (${branch})，commit ${commit.sha.slice(0, 7)}（${files.length} 个文件）`,
                commit: commit.sha,
                files: files.length
            });
        } catch (err) {
            ctx.log('push failed:', err.message);
            res.status(500).json({ error: '推送失败: ' + err.message.slice(0, 500) });
        }
    });
};