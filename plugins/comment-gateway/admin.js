(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('comment-gateway', {
        label: '评论提交网关（公共站）',
        render: function (data) {
            data = data || {};
            return `
                <div class="form-group">
                    <label>内容仓库</label>
                    <input type="text" id="cg-repo" value="${window.AdminCMS.esc(data.repo || 'xhrr/QMQ-SGLXQ')}" placeholder="xhrr/QMQ-SGLXQ">
                    <p class="form-help">访客留言的待审 Issue 建到这个仓库。</p>
                </div>
                <div class="form-group">
                    <label>待审标签</label>
                    <input type="text" id="cg-label" value="${window.AdminCMS.esc(data.label || 'comment-pending')}" placeholder="comment-pending">
                    <p class="form-help">表单提交自动打此标签；审核 = 把 Issue 标签改成 approved，由「GitHub Issues 内容更新」插件固化并自动部署。</p>
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="cg-check">检查 Token 与仓库</button>
                    <span id="cg-status" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
                <div class="form-group">
                    <p class="form-help" id="cg-last"></p>
                </div>
                <div class="form-group">
                    <p class="form-help"><strong>上线步骤：</strong>① 保存配置后执行「导出」（Function 随 dist 推送自动部署到 Pages）② Cloudflare Pages 后台 → 该项目 → Settings → 环境变量 → 添加 <code>GITHUB_TOKEN</code>（加密，与 github-issues 共用同一 Token）③ 站点上提交一条留言，仓库出现「留言待审」Issue 即通道打通。</p>
                    <p class="form-help">NAS/内网表单仍走 CMS 自带 /api/comments（即时展示，不经此网关）。当前渲染策略：页面无评论时不渲染评论区，首条留言可由站长经手工 Issue 补录。</p>
                </div>
            `;
        },
        collect: function () {
            return {
                repo: document.getElementById('cg-repo') ? document.getElementById('cg-repo').value.trim() : '',
                label: document.getElementById('cg-label') ? document.getElementById('cg-label').value.trim() : 'comment-pending'
            };
        },
        bind: function () {
            const btn = document.getElementById('cg-check');
            const status = document.getElementById('cg-status');
            const last = document.getElementById('cg-last');

            const sync = async () => {
                try {
                    const d = await (await fetch('/api/plugins/comment-gateway/status')).json();
                    if (last && d.lastStatus) {
                        last.textContent = `${d.lastStatus}（${String(d.lastCheck || '').replace('T', ' ').slice(0, 16)}）`;
                    }
                } catch (e) { /* 无视 */ }
            };
            setTimeout(sync, 100);
            if (!btn) return;

            btn.addEventListener('click', async () => {
                try {
                    // 先落盘配置，检查接口按已保存配置执行
                    await fetch('/api/plugins/comment-gateway/data', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            repo: document.getElementById('cg-repo').value.trim(),
                            label: document.getElementById('cg-label').value.trim()
                        })
                    });
                    status.textContent = '检查中…';
                    status.style.color = '';
                    const res = await fetch('/api/plugins/comment-gateway/check', { method: 'POST' });
                    const j = await res.json();
                    if (res.ok && j.ok) {
                        status.textContent = '✅ ' + (j.message || '检查通过');
                        status.style.color = '#28a745';
                    } else {
                        status.textContent = '❌ ' + (j.error || '检查失败');
                        status.style.color = '#dc3545';
                    }
                } catch (e) {
                    status.textContent = '❌ ' + e.message;
                    status.style.color = '#dc3545';
                }
                sync();
            });
        }
    });
})();
