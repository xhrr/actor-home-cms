(function () {
    'use strict';
    if (!window.AdminCMS) return;

    // bind() 由后台以普通函数调用（无 this），收集/保存统一走 panel.collect()
    const panel = {
        label: 'AI 内容审核',
        render: function (data) {
            data = data || {};
            const auto = data.autoApprove === true;
            const mailOn = data.mailEnabled === true;
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
                    <div style="margin-top:.5rem;display:flex;align-items:center;gap:.6rem">
                        <button class="btn btn--sm" id="ar-ai-test">测试 AI 连接</button>
                        <span id="ar-ai-status" style="font-size:0.82rem"></span>
                    </div>
                </div>
                <hr style="border:none;border-top:1px solid rgba(128,128,128,.25);margin:1rem 0">
                <div class="form-group">
                    <label>邮件提醒</label>
                    <label class="toggle-label">
                        <input type="checkbox" id="ar-mail-on" ${mailOn ? 'checked' : ''}> 开启邮件提醒（审核完成且有内容需要人工处理时发汇总；整轮失败也会提醒，60 分钟内不重复）
                    </label>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>SMTP 服务器</label>
                        <input type="text" id="ar-mail-host" value="${window.AdminCMS.esc(data.mailHost || '')}" placeholder="smtp.qq.com">
                    </div>
                    <div class="form-group">
                        <label>端口</label>
                        <input type="number" id="ar-mail-port" value="${window.AdminCMS.esc(data.mailPort != null ? data.mailPort : 465)}" placeholder="465">
                        <p class="form-help">465 = SSL；587/25 自动尝试 STARTTLS。</p>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>SMTP 账号</label>
                        <input type="text" id="ar-mail-user" value="${window.AdminCMS.esc(data.mailUser || '')}" placeholder="完整邮箱地址">
                    </div>
                    <div class="form-group">
                        <label>SMTP 授权码</label>
                        <input type="password" id="ar-mail-pass" value="${window.AdminCMS.esc(data.mailPass || '')}" placeholder="邮箱设置里生成的授权码，不是登录密码">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>发件人（可选）</label>
                        <input type="text" id="ar-mail-from" value="${window.AdminCMS.esc(data.mailFrom || '')}" placeholder="留空 = SMTP 账号">
                    </div>
                    <div class="form-group">
                        <label>收件人</label>
                        <input type="text" id="ar-mail-to" value="${window.AdminCMS.esc(data.mailTo || '')}" placeholder="多个用逗号分隔">
                    </div>
                </div>
                <div class="form-group">
                    <label class="toggle-label">
                        <input type="checkbox" id="ar-mail-every" ${data.mailOnEveryRun === true ? 'checked' : ''}> 全部通过也发摘要（默认只在需要人工处理时发）
                    </label>
                    <input type="text" id="ar-mail-reviewurl" style="margin-top:.5rem" value="${window.AdminCMS.esc(data.mailReviewUrl || '')}" placeholder="站内复审页地址（可选），如 http://NAS-IP:3123/plugins/ai-review/index.html">
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="ar-run">立即审核一轮</button>
                    <button class="btn btn--ghost btn--sm" id="ar-mail-test">发送测试邮件</button>
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
                autoApprove: !!(document.getElementById('ar-auto') || {}).checked,
                mailEnabled: !!(document.getElementById('ar-mail-on') || {}).checked,
                mailHost: g('ar-mail-host').trim(),
                mailPort: parseInt(g('ar-mail-port'), 10) || 465,
                mailUser: g('ar-mail-user').trim(),
                mailPass: g('ar-mail-pass').trim(),
                mailFrom: g('ar-mail-from').trim(),
                mailTo: g('ar-mail-to').trim(),
                mailOnEveryRun: !!(document.getElementById('ar-mail-every') || {}).checked,
                mailReviewUrl: g('ar-mail-reviewurl').trim()
            };
        },
        bind: function () {
            const btn = document.getElementById('ar-run');
            const testBtn = document.getElementById('ar-mail-test');
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

            // 面板保存统一走 collect()（「立即审核」与「发送测试邮件」都先保存再动作，
            // 避免两处内联字段清单漂移——漏一个字段保存时就会被整体替换抹掉）
            const saveData = () => fetch('/api/plugins/ai-review/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(panel.collect())
            });

            // AI 连接测试：先保存当前表单值再测（测的就是刚填的配置）
            const aiBtn = document.getElementById('ar-ai-test');
            if (aiBtn) {
                const aiStatus = document.getElementById('ar-ai-status');
                aiBtn.addEventListener('click', async () => {
                    aiBtn.disabled = true;
                    if (aiStatus) { aiStatus.textContent = '测试中…'; aiStatus.style.color = ''; }
                    try {
                        await saveData();
                        const res = await fetch('/api/plugins/ai-review/ai-test', { method: 'POST' });
                        const j = await res.json();
                        if (!res.ok || !j.ok) throw new Error(j.error || ('http ' + res.status));
                        if (aiStatus) {
                            aiStatus.textContent = `✅ ${j.model}（${j.ms}ms）：${j.reply}`;
                            aiStatus.style.color = '#28a745';
                        }
                    } catch (e) {
                        if (aiStatus) { aiStatus.textContent = '❌ ' + e.message; aiStatus.style.color = '#dc3545'; }
                    }
                    aiBtn.disabled = false;
                });
            }

            btn.addEventListener('click', async () => {
                btn.disabled = true;
                status.textContent = '审核中…（多图需数十秒）';
                status.style.color = '';
                try {
                    await saveData();
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

            if (testBtn) {
                testBtn.addEventListener('click', async () => {
                    testBtn.disabled = true;
                    status.textContent = '发送测试邮件中…';
                    status.style.color = '';
                    try {
                        await saveData();
                        const res = await fetch('/api/plugins/ai-review/mail-test', { method: 'POST' });
                        const j = await res.json();
                        if (!res.ok) throw new Error(j.error || ('http ' + res.status));
                        status.textContent = '✅ ' + (j.message || '测试邮件已发送');
                        status.style.color = '#28a745';
                    } catch (e) {
                        status.textContent = '❌ ' + e.message;
                        status.style.color = '#dc3545';
                    }
                    testBtn.disabled = false;
                });
            }
        }
    };

    window.AdminCMS.registerPluginPanel('ai-review', panel);
})();
