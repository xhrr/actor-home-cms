(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('ai-review', {
        label: 'AI 内容审核',
        render: function (data) {
            data = data || {};
            const auto = data.autoApprove === true;
            return `
                <div class="form-group">
                    <label>审核模式</label>
                    <label class="toggle-label">
                        <input type="checkbox" id="ar-auto" ${auto ? 'checked' : ''}> 自动放行（AI 判定安全时自动改标签为 approved）
                    </label>
                    <p class="form-help">${auto ? '当前：自动放行。' : '当前：建议模式——AI 只打标记并附理由，等人工在审核页放行。'}建议先跑建议模式观察准确率。</p>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>跳过标签</label>
                        <input type="text" id="ar-skip" value="${window.AdminCMS.esc(data.skipLabels || '')}" placeholder="留空 = 不跳过">
                        <p class="form-help">命中的标签一律不审核。留空即「只要未审核过就审」。</p>
                    </div>
                    <div class="form-group">
                        <label>待审标记（完成时移除）</label>
                        <input type="text" id="ar-pending" value="${window.AdminCMS.esc(data.pendingLabels || 'content-pending,comment-pending')}">
                        <p class="form-help">提交网关打的标签；审核完成后会移除（表示不再待审）。</p>
                    </div>
                </div>
                <p class="form-help" style="margin:-0.4rem 0 0.8rem">审核范围：<b>全部 open Issue 中，未带「${window.AdminCMS.esc(data.reviewedLabel || 'ai-reviewed')}」标签的都会被审核</b>——包括直接在 GitHub 手动新建、没有任何标签的 Issue。</p>
                <div class="form-row">
                    <div class="form-group">
                        <label>放行标签</label>
                        <input type="text" id="ar-approved" value="${window.AdminCMS.esc(data.approvedLabel || 'approved')}">
                    </div>
                    <div class="form-group">
                        <label>已审核标签</label>
                        <input type="text" id="ar-reviewed" value="${window.AdminCMS.esc(data.reviewedLabel || 'ai-reviewed')}">
                        <p class="form-help">队列判据：带此标签的不再审核。</p>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>图片抽查张数</label>
                        <input type="number" id="ar-sample" min="1" max="10" value="${window.AdminCMS.esc(data.sampleCount != null ? data.sampleCount : 3)}">
                        <p class="form-help">首图必审 + 其余随机抽样，控制耗时与 token。</p>
                    </div>
                    <div class="form-group">
                        <label>轮询间隔（分钟）</label>
                        <input type="number" id="ar-interval" min="1" value="${window.AdminCMS.esc(data.pollInterval != null ? data.pollInterval : 15)}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>MiMo 模型</label>
                        <input type="text" id="ar-model" value="${window.AdminCMS.esc(data.llmModel || '')}" placeholder="留空继承「倩一波日常」的配置">
                    </div>
                    <div class="form-group">
                        <label>MiMo Base URL</label>
                        <input type="text" id="ar-base" value="${window.AdminCMS.esc(data.llmBaseUrl || '')}" placeholder="留空继承">
                    </div>
                </div>
                <div class="form-group">
                    <label>MiMo API Key</label>
                    <input type="password" id="ar-key" value="${window.AdminCMS.esc(data.llmKey || '')}" placeholder="留空继承「倩一波日常」的 Key">
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="ar-run">立即审核一轮</button>
                    <span id="ar-status" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
                <div class="form-group">
                    <p class="form-help" id="ar-last"></p>
                    <p class="form-help"><a href="/plugins/ai-review/index.html" target="_blank">打开审核记录页 →</a>（查看全部已审核内容、按通过/未通过筛选、人工复审改标签）</p>
                </div>
            `;
        },
        collect: function () {
            const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
            return {
                pendingLabels: g('ar-pending').trim() || 'content-pending,comment-pending',
                skipLabels: g('ar-skip').trim(),
                approvedLabel: g('ar-approved').trim() || 'approved',
                reviewedLabel: g('ar-reviewed').trim() || 'ai-reviewed',
                sampleCount: parseInt(g('ar-sample'), 10) || 3,
                pollInterval: parseInt(g('ar-interval'), 10) || 15,
                llmModel: g('ar-model').trim(),
                llmBaseUrl: g('ar-base').trim(),
                llmKey: g('ar-key').trim(),
                autoApprove: !!(document.getElementById('ar-auto') || {}).checked
            };
        },
        bind: function () {
            const btn = document.getElementById('ar-run');
            const status = document.getElementById('ar-status');
            const last = document.getElementById('ar-last');

            const sync = async () => {
                try {
                    const d = await (await fetch('/api/plugins/ai-review/history')).json();
                    if (last && d.lastStatus) {
                        last.textContent = `${d.lastStatus}（${String(d.lastRun || '').replace('T', ' ').slice(0, 16)}）`;
                    }
                } catch (e) { /* 无视 */ }
            };
            setTimeout(sync, 100);
            if (!btn) return;

            btn.addEventListener('click', async () => {
                btn.disabled = true;
                status.textContent = '审核中…（多图需数十秒）';
                status.style.color = '';
                try {
                    // 先保存面板配置再执行（collect 直接构造，避免依赖内部注册表）
                    const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
                    await fetch('/api/plugins/ai-review/data', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pendingLabels: g('ar-pending').trim() || 'content-pending,comment-pending',
                            skipLabels: g('ar-skip').trim(),
                            approvedLabel: g('ar-approved').trim() || 'approved',
                            reviewedLabel: g('ar-reviewed').trim() || 'ai-reviewed',
                            sampleCount: parseInt(g('ar-sample'), 10) || 3,
                            pollInterval: parseInt(g('ar-interval'), 10) || 15,
                            llmModel: g('ar-model').trim(),
                            llmBaseUrl: g('ar-base').trim(),
                            llmKey: g('ar-key').trim(),
                            autoApprove: !!(document.getElementById('ar-auto') || {}).checked
                        })
                    });
                    const res = await fetch('/api/plugins/ai-review/run', { method: 'POST' });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error || ('http ' + res.status));
                    status.textContent = '✅ ' + (j.status || '完成');
                    status.style.color = '#28a745';
                } catch (e) {
                    status.textContent = '❌ ' + e.message;
                    status.style.color = '#dc3545';
                }
                btn.disabled = false;
                sync();
            });
        }
    });
})();
