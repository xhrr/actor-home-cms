(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('github-issues', {
        label: 'GitHub Issues 内容更新',
        render: function (data) {
            data = data || {};
            return `
                <div class="form-group">
                    <label>仓库</label>
                    <input type="text" id="gi-repo" value="${window.AdminCMS.esc(data.repo || '')}" placeholder="例如：xhrr/QMQ-SGLXQ">
                </div>
                <div class="form-group">
                    <label>Token</label>
                    <div class="token-field">
                        <input type="password" id="gi-token" value="${window.AdminCMS.esc(data.token || '')}" placeholder="GitHub Token">
                        <button type="button" class="btn btn--sm" id="gi-token-toggle">显示</button>
                    </div>
                </div>
                <div class="form-group">
                    <label>审核 Label</label>
                    <input type="text" id="gi-label" value="${window.AdminCMS.esc(data.label || 'approved')}" placeholder="approved">
                    <p class="form-help">只有带有该 Label 的 Issue 才会被处理。</p>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>轮询间隔（分钟）</label>
                        <input type="number" id="gi-interval" min="1" value="${window.AdminCMS.esc(data.pollInterval || '10')}">
                    </div>
                    <div class="form-group">
                        <label class="toggle-label">
                            <input type="checkbox" id="gi-autopush" ${data.autoPush !== false ? 'checked' : ''}> 更新后自动导出并推送
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="gi-check">立即检查</button>
                    <span id="gi-status" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
                <div class="form-group">
                    <p class="form-help" id="gi-last"></p>
                </div>
            `;
        },
        collect: function () {
            return {
                repo: document.getElementById('gi-repo') ? document.getElementById('gi-repo').value : '',
                token: document.getElementById('gi-token') ? document.getElementById('gi-token').value : '',
                label: document.getElementById('gi-label') ? document.getElementById('gi-label').value : 'approved',
                pollInterval: document.getElementById('gi-interval') ? parseInt(document.getElementById('gi-interval').value, 10) || 10 : 10,
                autoPush: document.getElementById('gi-autopush') ? document.getElementById('gi-autopush').checked : true
            };
        },
        bind: function () {
            const tokenToggle = document.getElementById('gi-token-toggle');
            const tokenInput = document.getElementById('gi-token');
            if (tokenToggle && tokenInput) {
                tokenToggle.addEventListener('click', () => {
                    const show = tokenInput.type === 'password';
                    tokenInput.type = show ? 'text' : 'password';
                    tokenToggle.textContent = show ? '隐藏' : '显示';
                });
            }

            const btn = document.getElementById('gi-check');
            if (!btn) return;

            // 保存配置
            const saveData = () => {
                const data = {
                    repo: document.getElementById('gi-repo').value,
                    token: document.getElementById('gi-token').value,
                    label: document.getElementById('gi-label').value,
                    pollInterval: parseInt(document.getElementById('gi-interval').value, 10) || 10,
                    autoPush: document.getElementById('gi-autopush').checked
                };
                return fetch('/api/plugins/github-issues/data', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            };

            btn.addEventListener('click', async () => {
                const status = document.getElementById('gi-status');
                const last = document.getElementById('gi-last');
                try {
                    // 保存接口会回传持久化后的完整数据，用它回显表单值
                    const saveRes = await saveData();
                    const saved = await saveRes.json().catch(() => ({}));
                    if (saved && saved.data) {
                        const val = saved.data.pollInterval;
                        const input = document.getElementById('gi-interval');
                        if (input && val != null) input.value = val;
                    }
                    if (status) {
                        status.textContent = '检查中…';
                        status.style.color = '';
                    }
                    const res = await fetch('/api/plugins/github-issues/check', { method: 'POST' });
                    const json = await res.json();
                    if (res.ok) {
                        if (status) {
                            status.textContent = '✅ ' + (json.status || '完成');
                            status.style.color = '#28a745';
                        }
                        if (last) last.textContent = (json.messages || []).join('；');
                    } else {
                        if (status) {
                            status.textContent = '❌ ' + (json.error || '检查失败');
                            status.style.color = '#dc3545';
                        }
                    }
                } catch (e) {
                    if (status) {
                        status.textContent = '❌ ' + e.message;
                        status.style.color = '#dc3545';
                    }
                }
            });
        }
    });
})();
