/**
 * GitHub 部署插件
 * 提供 API：将 dist/ 推送到 GitHub 仓库，并保持 dist/ 目录结构
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = function (ctx) {
    const DIST_DIR = path.join(__dirname, '..', '..', 'dist');
    const STAGE_DIR = path.join(__dirname, '..', '..', '.deploy-stage');

    function copyDistToStage() {
        if (fs.existsSync(STAGE_DIR)) fs.rmSync(STAGE_DIR, { recursive: true, force: true });
        fs.mkdirSync(STAGE_DIR, { recursive: true });
        const target = path.join(STAGE_DIR, 'dist');
        fs.cpSync(DIST_DIR, target, { recursive: true });
        return target;
    }

    ctx.app.post('/api/plugins/github-deploy/push', (req, res) => {
        let stageCleanup = null;
        try {
            const config = ctx.getData();
            const repoRaw = (config.repo || '').trim();
            // 兼容 owner/repo 简写；其余格式（完整 URL / git@ 地址）原样使用
            const repo = /^[\w.-]+\/[\w.-]+$/.test(repoRaw)
                ? `https://github.com/${repoRaw}.git`
                : repoRaw;
            const branch = (config.branch || 'main').trim();
            const token = (config.token || '').trim();

            if (!repo) {
                return res.status(400).json({ error: '请先在插件配置中填写 GitHub 仓库地址' });
            }
            if (!fs.existsSync(DIST_DIR) || fs.readdirSync(DIST_DIR).length === 0) {
                return res.status(400).json({ error: 'dist 不存在，请先在后台执行「导出到 dist/」' });
            }

            const remote = token
                ? repo.replace(/^https?:\/\//, `https://x-access-token:${token}@`)
                : repo;

            // 在临时目录中生成 dist/ 文件夹，再推送到仓库
            const repoDir = copyDistToStage();
            stageCleanup = STAGE_DIR;

            // 每次推送前清理旧 git 历史，避免敏感信息残留在提交记录中
            const gitDir = path.join(repoDir, '.git');
            if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true, force: true });

            const run = (cmd) => execSync(cmd, {
                cwd: repoDir,
                stdio: 'pipe',
                encoding: 'utf-8',
                timeout: 60000,
                env: {
                    ...process.env,
                    GIT_TERMINAL_PROMPT: '0',
                    GIT_ASKPASS: 'echo'
                }
            });

            run('git init -q');
            run('git config user.name "Actor CMS"');
            run('git config user.email "actor@localhost"');
            run('git add -A');
            try {
                run(`git commit -q -m "deploy: ${new Date().toISOString()}"`);
            } catch (e) {
                try {
                    run('git rev-parse --verify HEAD');
                } catch (noHead) {
                    run('git commit -q --allow-empty -m "deploy: init"');
                }
            }
            run(`git branch -M ${branch}`);
            try {
                run(`git remote remove origin`);
            } catch (e) { /* ignore */ }
            run(`git remote add origin ${remote}`);
            run(`git push -u origin ${branch} --force`);

            res.json({ success: true, message: `已推送到 ${repo} (${branch})` });
        } catch (err) {
            ctx.log('push failed:', err.message);
            const msg = (err.stdout || err.stderr || err.message || '').toString().slice(-500);
            res.status(500).json({ error: '推送失败: ' + msg });
        } finally {
            if (stageCleanup && fs.existsSync(stageCleanup)) {
                fs.rmSync(stageCleanup, { recursive: true, force: true });
            }
        }
    });
};
