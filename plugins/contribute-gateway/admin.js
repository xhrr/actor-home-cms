(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('contribute-gateway', {
        label: '投稿网关（公共站）',
        render: function (data) {
            data = data || {};
            return `
                <div class="form-group">
                    <label>内容仓库</label>
                    <input type="text" id="cgw-repo" value="${window.AdminCMS.esc(data.repo || 'xhrr/QMQ-SGLXQ')}" placeholder="xhrr/QMQ-SGLXQ">
                </div>
                <div class="form-group">
                    <label>待审标签</label>
                    <input type="text" id="cgw-label" value="${window.AdminCMS.esc(data.label || 'content-pending')}" placeholder="content-pending">
                    <p class="form-help">投稿自动打此标签；审核 = 把 Issue 标签改成 approved，由「GitHub Issues 内容更新」插件固化并自动部署。</p>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>图床域名</label>
                        <input type="text" id="cgw-base" value="${window.AdminCMS.esc(data.publicBase || 'img.sglxq.cn')}" placeholder="img.sglxq.cn">
                    </div>
                    <div class="form-group">
                        <label>对象 key 前缀</label>
                        <input type="text" id="cgw-prefix" value="${window.AdminCMS.esc(data.keyPrefix || 'img/mqq')}" placeholder="img/mqq">
                    </div>
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="cgw-check">检查 Token 与仓库</button>
                    <span id="cgw-status" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
                <div class="form-group">
                    <p class="form-help" id="cgw-last"></p>
                </div>
                <div class="form-group">
                    <p class="form-help"><strong>上线步骤：</strong>① 保存配置后执行「导出」（Function 随 dist 推送自动部署到 Pages，路径 functions/api/contribute.js）② Cloudflare Pages 后台 → Settings → Functions → <strong>R2 存储桶绑定</strong>：绑定图床桶，变量名必须为 <code>BUCKET</code> ③ 环境变量添加 <code>GITHUB_TOKEN</code>（与 github-issues 共用）④ 打开 /contribute.html 提交一条测试投稿，仓库出现「投稿待审」Issue 即通道打通。</p>
                    <p class="form-help">防滥用：同源校验 + 每 IP 10 分钟 5 次 + 待审人工闸（未配置投稿口令）。投稿页：/contribute.html。</p>
                </div>
            `;
        },
        collect: function () {
            return {
                repo: document.getElementById('cgw-repo') ? document.getElementById('cgw-repo').value.trim() : '',
                label: document.getElementById('cgw-label') ? document.getElementById('cgw-label').value.trim() : 'content-pending',
                publicBase: document.getElementById('cgw-base') ? document.getElementById('cgw-base').value.trim() : 'img.sglxq.cn',
                keyPrefix: document.getElementById('cgw-prefix') ? document.getElementById('cgw-prefix').value.trim() : 'img/mqq'
            };
        },
        bind: function () {
            const btn = document.getElementById('cgw-check');
            const status = document.getElementById('cgw-status');
            const last = document.getElementById('cgw-last');

            const sync = async () => {
                try {
                    const d = await (await fetch('/api/plugins/contribute-gateway/status')).json();
                    if (last && d.lastStatus) {
                        last.textContent = `${d.lastStatus}（${String(d.lastCheck || '').replace('T', ' ').slice(0, 16)}）`;
                    }
                } catch (e) { /* 无视 */ }
            };
            setTimeout(sync, 100);
            if (!btn) return;

            btn.addEventListener('click', async () => {
                try {
                    await fetch('/api/plugins/contribute-gateway/data', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            repo: document.getElementById('cgw-repo').value.trim(),
                            label: document.getElementById('cgw-label').value.trim(),
                            publicBase: document.getElementById('cgw-base').value.trim(),
                            keyPrefix: document.getElementById('cgw-prefix').value.trim()
                        })
                    });
                    status.textContent = '检查中…';
                    status.style.color = '';
                    const res = await fetch('/api/plugins/contribute-gateway/check', { method: 'POST' });
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
