(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('github-deploy', {
        label: 'GitHub 部署',
        render: function (data) {
            data = data || {};
            return `
                <div class="form-group">
                    <label>仓库地址</label>
                    <input type="text" id="gh-repo" value="${window.AdminCMS.esc(data.repo || '')}" placeholder="https://github.com/user/repo.git">
                    <p class="form-help">支持 HTTPS 仓库地址。</p>
                </div>
                <div class="form-group">
                    <label>分支</label>
                    <input type="text" id="gh-branch" value="${window.AdminCMS.esc(data.branch || 'main')}" placeholder="main">
                </div>
                <div class="form-group">
                    <label>Token</label>
                    <div class="token-field">
                        <input type="password" id="gh-token" value="${window.AdminCMS.esc(data.token || '')}" placeholder="GitHub Personal Access Token">
                        <button type="button" class="btn btn--sm" id="gh-token-toggle">显示</button>
                    </div>
                    <p class="form-help">有仓库推送权限的 Token；留空则使用本机 git 凭据。</p>
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="gh-push">推送 dist 到 GitHub</button>
                    <span id="gh-result" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
            `;
        },
        collect: function () {
            return {
                repo: document.getElementById('gh-repo') ? document.getElementById('gh-repo').value : '',
                branch: document.getElementById('gh-branch') ? document.getElementById('gh-branch').value : 'main',
                token: document.getElementById('gh-token') ? document.getElementById('gh-token').value : ''
            };
        },
        bind: function () {
            const tokenToggle = document.getElementById('gh-token-toggle');
            const tokenInput = document.getElementById('gh-token');
            if (tokenToggle && tokenInput) {
                tokenToggle.addEventListener('click', () => {
                    const show = tokenInput.type === 'password';
                    tokenInput.type = show ? 'text' : 'password';
                    tokenToggle.textContent = show ? '隐藏' : '显示';
                });
            }

            const btn = document.getElementById('gh-push');
            if (!btn) return;
            btn.addEventListener('click', async () => {
                // 先保存插件配置
                const data = {
                    repo: document.getElementById('gh-repo').value,
                    branch: document.getElementById('gh-branch').value,
                    token: document.getElementById('gh-token').value
                };
                const result = document.getElementById('gh-result');
                if (result) result.textContent = '推送中…';

                try {
                    await fetch('/api/plugins/github-deploy/data', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    const res = await fetch('/api/plugins/github-deploy/push', { method: 'POST' });
                    const json = await res.json();
                    if (res.ok) {
                        if (result) {
                            result.textContent = '✅ ' + (json.message || '推送成功');
                            result.style.color = '#28a745';
                        }
                    } else {
                        if (result) {
                            result.textContent = '❌ ' + (json.error || '推送失败');
                            result.style.color = '#dc3545';
                        }
                    }
                } catch (e) {
                    if (result) {
                        result.textContent = '❌ ' + e.message;
                        result.style.color = '#dc3545';
                    }
                }
            });
        }
    });
})();
