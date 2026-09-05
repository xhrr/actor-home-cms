(function () {
    'use strict';
    if (!window.AdminCMS) return;

    const N = 'qq-channel-watch';
    // 服务端当前数据缓存：collect 保存时合并回去，避免覆盖 processed/issueFeedIds 等轮询状态
    let currentData = {};
    const refreshData = async () => {
        try { currentData = await (await fetch(`/api/plugins/${N}/data`)).json(); } catch (e) { /* 保持旧缓存 */ }
    };
    // 面板字段 + 服务端当前数据合并；所有写路径（保存/重连）统一走这里
    function collectPanel() {
        const merged = Object.assign({}, currentData);
        const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
        const chk = id => { const el = document.getElementById(id); return el ? el.checked : false; };
        merged.guildId = val('qcw-guild-id').trim();
        merged.cliPath = val('qcw-cli-path').trim();
        merged.count = parseInt(val('qcw-count'), 10) || 20;
        merged.pollInterval = parseInt(val('qcw-interval'), 10) || 10;
        merged.keyword = val('qcw-keyword').trim();
        merged.enabled = chk('qcw-enabled');
        merged.appId = val('qcw-app-id').trim();
        merged.clientSecret = val('qcw-app-secret');
        merged.autoComment = chk('qcw-auto-comment');
        merged.boardMap = val('qcw-board-map');
        merged.issueLabel = val('qcw-issue-label').trim() || 'qq-channel';
        merged.autoCreateIssue = chk('qcw-auto-create');
        merged.statusReply = chk('qcw-status-reply');
        return merged;
    }

    window.AdminCMS.registerPluginPanel(N, {
        label: 'QQ 频道监控（demo）',
        render: function (data) {
            data = data || {};
            return `
                <div class="form-group">
                    <label>频道 ID（纯数字 guild ID，不是字母数字"频道号"）</label>
                    <input type="text" id="qcw-guild-id" value="${window.AdminCMS.esc(data.guildId || '')}" placeholder="例如：85686521788351874">
                    <p class="form-help">登录后可运行插件自带 CLI 查询：<code>bin/tencent-channel-cli manage get-my-join-guild-info -j</code>，输出里的 guild_id 即是。CLI 已随插件自带，也可在下方自定义路径。</p>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>CLI 路径（可选，留空用插件自带）</label>
                        <input type="text" id="qcw-cli-path" value="${window.AdminCMS.esc(data.cliPath || '')}" placeholder="tencent-channel-cli">
                    </div>
                    <div class="form-group">
                        <label>每次拉取条数</label>
                        <input type="number" id="qcw-count" min="1" max="50" value="${window.AdminCMS.esc(data.count || 20)}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>轮询间隔（分钟）</label>
                        <input type="number" id="qcw-interval" min="1" value="${window.AdminCMS.esc(data.pollInterval || 10)}">
                    </div>
                    <div class="form-group">
                        <label>关键词过滤（可选，标题/正文包含才收录）</label>
                        <input type="text" id="qcw-keyword" value="${window.AdminCMS.esc(data.keyword || '')}" placeholder="留空收录全部">
                    </div>
                </div>
                <div class="form-group">
                    <label class="toggle-label">
                        <input type="checkbox" id="qcw-enabled" ${data.enabled !== false ? 'checked' : ''}> 启用自动轮询（兜底；@ 触发为主）
                    </label>
                </div>

                <div class="form-group" style="margin-top:1.2rem;padding-top:1rem;border-top:1px solid rgba(128,128,128,.2)">
                    <label>帖子 → GitHub Issue（按版块解析）</label>
                    <label style="margin-top:.6rem">版块 → 类型映射（每行一条：版块名=works/album/news/awards/schedule）</label>
                    <textarea id="qcw-board-map" rows="5">${window.AdminCMS.esc(data.boardMap || '作品新增=works\n图集新增=album\n动态=news\n行程=schedule\n荣誉=awards')}</textarea>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Issue 标签（人工过目后改 approved 即上线）</label>
                            <input type="text" id="qcw-issue-label" value="${window.AdminCMS.esc(data.issueLabel || 'qq-channel')}">
                        </div>
                        <div class="form-group">
                            <label class="toggle-label" style="margin-top:1.5rem">
                                <input type="checkbox" id="qcw-auto-create" ${data.autoCreateIssue === true ? 'checked' : ''}> 轮询时自动创建 Issue（不开则走预览 → 手动更新）
                            </label>
                            <label class="toggle-label">
                                <input type="checkbox" id="qcw-status-reply" ${data.statusReply !== false ? 'checked' : ''}> 处理后在帖子下回执（已处理/未处理原因）
                            </label>
                        </div>
                    </div>
                    <p class="form-help">正文必须自带原始链接（http/https），未带的帖子自动跳过；类型由版块映射决定；AI 抽取字段默认开启，凭证继承「倩一波日常」插件的 MiMo 配置。</p>
                </div>

                <div class="form-group" style="margin-top:1.2rem;padding-top:1rem;border-top:1px solid rgba(128,128,128,.2)">
                    <label>机器人 WebSocket（@ 触发：有人 @ 机器人 → 立即拉取新帖并自动评论回原帖）</label>
                    <div class="form-row">
                        <div class="form-group">
                            <label>App ID</label>
                            <input type="text" id="qcw-app-id" value="${window.AdminCMS.esc(data.appId || '')}" placeholder="QQ 开放平台 AppID">
                        </div>
                        <div class="form-group">
                            <label>Client Secret</label>
                            <input type="password" id="qcw-app-secret" value="${window.AdminCMS.esc(data.clientSecret || '')}" placeholder="AppSecret">
                        </div>
                    </div>
                    <label class="toggle-label">
                        <input type="checkbox" id="qcw-auto-comment" ${data.autoComment !== false ? 'checked' : ''}> 触发后自动把新帖内容评论回原帖
                    </label>
                    <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-top:.6rem">
                        <button type="button" class="btn btn--ghost btn--sm" id="qcw-ws-reconnect">保存并连接</button>
                        <span id="qcw-ws-status" style="font-size:.85rem"></span>
                    </div>
                    <p class="form-help">凭证来自 QQ 开放平台（与频道机器人同账号）。连接建立后，频道内 @ 机器人即触发；帖子内容会以机器人登录账号（CLI 扫码账号）发到原帖评论区。</p>
                </div>

                <div class="form-group" style="margin-top:1.2rem;padding-top:1rem;border-top:1px solid rgba(128,128,128,.2)">
                    <label>扫码登录（QQ AI Connect，登录态由 CLI 本机自管）</label>
                    <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
                        <button type="button" class="btn btn--ghost btn--sm" id="qcw-login-refresh">刷新登录状态</button>
                        <button type="button" class="btn btn--primary btn--sm" id="qcw-login-qr">获取登录二维码</button>
                        <button type="button" class="btn btn--ghost btn--sm" id="qcw-login-poll" style="display:none">我已扫码，完成登录</button>
                        <span id="qcw-login-status" style="font-size:.85rem"></span>
                    </div>
                    <div id="qcw-login-qrbox" style="display:none;margin-top:.75rem">
                        <img id="qcw-login-qrimg" alt="登录二维码" style="width:200px;height:200px;border:1px solid rgba(128,128,128,.3)">
                        <p class="form-help" id="qcw-login-link"></p>
                    </div>
                </div>

                <div class="form-group">
                    <button type="button" class="btn btn--ghost btn--sm" id="qcw-preview-parse">预览解析结果</button>
                    <button type="button" class="btn btn--primary btn--sm" id="qcw-create-issues">更新到 Issues</button>
                </div>
                <div class="form-group">
                    <p class="form-help" id="qcw-result" style="white-space:pre-wrap"></p>
                    <p class="form-help" id="qcw-last"></p>
                </div>
            `;
        },
        collect: function () {
            return collectPanel();
        },
        bind: async function () {
            const $ = id => document.getElementById(id);
            await refreshData();
            const show = (msg, isErr) => {
                const el = $('qcw-login-status');
                if (el) { el.textContent = msg; el.style.color = isErr ? '#dc3545' : ''; }
            };
            const refreshStatus = async () => {
                try {
                    await refreshData();
                    const r = await fetch(`/api/plugins/${N}/status`);
                    const d = await r.json();
                    const lastEl = $('qcw-last');
                    if (lastEl) {
                        lastEl.textContent = [
                            d.loggedIn ? '✅ 已登录' : '⚠️ 未登录',
                            d.guildId ? '频道 ' + d.guildId : '未填频道 ID',
                            d.lastStatus,
                            d.processedCount ? `已处理 ${d.processedCount} 条` : ''
                        ].filter(Boolean).join(' · ');
                    }
                    show(d.loggedIn ? '✅ 已登录' : '⚠️ ' + (d.loginDetail || '未登录'), !d.loggedIn);
                    const wsEl = $('qcw-ws-status');
                    if (wsEl) {
                        const w = d.ws || {};
                        const txt = !w.configured ? '未配置机器人凭证'
                            : w.connected ? '✅ WS 已连接（@ 机器人即触发）'
                            : '❌ ' + (w.lastError || '未连接');
                        wsEl.textContent = txt;
                        wsEl.style.color = w.connected ? '#28a745' : (!w.configured ? '' : '#dc3545');
                    }
                } catch (e) { show('状态获取失败: ' + e.message, true); }
            };
            setTimeout(refreshStatus, 100);

            $('qcw-login-refresh') && $('qcw-login-refresh').addEventListener('click', refreshStatus);

            $('qcw-ws-reconnect') && $('qcw-ws-reconnect').addEventListener('click', async () => {
                const s = $('qcw-ws-status');
                try {
                    // 先保存面板凭证（collectPanel 合并轮询状态），再重连
                    await fetch(`/api/plugins/${N}/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectPanel()) });
                    if (s) s.textContent = '连接中…';
                    await fetch(`/api/plugins/${N}/ws/reconnect`, { method: 'POST' });
                    setTimeout(refreshStatus, 2500);
                    setTimeout(refreshStatus, 6000);
                } catch (e) { if (s) { s.textContent = '❌ ' + e.message; s.style.color = '#dc3545'; } }
            });

            $('qcw-login-qr') && $('qcw-login-qr').addEventListener('click', async () => {
                show('二维码生成中…');
                try {
                    const r = await fetch(`/api/plugins/${N}/login/qrcode`, { method: 'POST' });
                    const d = await r.json();
                    if (!r.ok) return show('❌ ' + (d.error || '二维码获取失败'), true);
                    const box = $('qcw-login-qrbox');
                    if (box) box.style.display = '';
                    const img = $('qcw-login-qrimg');
                    if (img && d.qrDataUrl) img.src = d.qrDataUrl;
                    const linkEl = $('qcw-login-link');
                    if (linkEl) linkEl.textContent = d.link ? '或打开链接授权：' + d.link : (d.message || '');
                    const pollBtn = $('qcw-login-poll');
                    if (pollBtn) pollBtn.style.display = '';
                    show('请用手机 QQ 扫码（' + (d.expiresIn || 599) + ' 秒内有效）');
                } catch (e) { show('❌ ' + e.message, true); }
            });

            $('qcw-login-poll') && $('qcw-login-poll').addEventListener('click', async () => {
                try {
                    await fetch(`/api/plugins/${N}/login/poll`, { method: 'POST' });
                    show('等待手机端确认授权…（最长 10 分钟，可离开此页）');
                    const timer = setInterval(async () => {
                        try {
                            const s = await (await fetch(`/api/plugins/${N}/login/poll-status`)).json();
                            if (s.polling) return;
                            clearInterval(timer);
                            if (s.done && !s.ok) show('❌ ' + (s.message || '授权失败'), true);
                            else show('✅ ' + (s.message || '授权完成'));
                            refreshStatus();
                        } catch (e) { clearInterval(timer); show('❌ ' + e.message, true); }
                    }, 4000);
                } catch (e) { show('❌ ' + e.message, true); }
            });

            $('qcw-create-issues') && $('qcw-create-issues').addEventListener('click', async () => {
                const res = $('qcw-result');
                if (res) res.textContent = '创建中…（下载图片并转存 R2，稍等）';
                try {
                    const r = await fetch(`/api/plugins/${N}/create-issues`, { method: 'POST' });
                    const d = await r.json();
                    if (!r.ok || !d.ok) {
                        if (res) { res.textContent = '❌ ' + (d.error || '创建失败'); res.style.color = '#dc3545'; }
                        return;
                    }
                    const urls = (d.results || []).filter(x => x.issueUrl).map(x => x.issueUrl).join('\n');
                    if (res) { res.textContent = `✅ 已创建 ${d.created} 条 Issue，跳过 ${d.skipped} 条${urls ? '\n' + urls : ''}`; res.style.color = ''; }
                    refreshStatus();
                } catch (e) { if (res) { res.textContent = '❌ ' + e.message; res.style.color = '#dc3545'; } }
            });

            $('qcw-preview-parse') && $('qcw-preview-parse').addEventListener('click', async () => {
                const res = $('qcw-result');
                if (res) res.textContent = '解析中…（逐帖拉取详情，稍等）';
                try {
                    const r = await fetch(`/api/plugins/${N}/preview-parse`, { method: 'POST' });
                    const d = await r.json();
                    if (!r.ok || !d.ok) {
                        if (res) { res.textContent = '❌ ' + (d.error || '解析失败'); res.style.color = '#dc3545'; }
                        return;
                    }
                    const lines = (d.results || []).map(x => x.skip
                        ? `跳过 [${x.title}]：${x.skip}`
                        : `[${x.type}·${x.parseBy}] ${x.issueTitle}\n${x.body}`);
                    const hint = d.pendingCount ? `\n\n————\n以上 ${d.pendingCount} 条待创建：点「更新到 Issues」执行（转存图片到 R2 并创建 Issue）。` : '';
                    if (res) { res.textContent = `共 ${d.total} 条：\n\n${lines.join('\n\n————\n\n')}${hint}`; res.style.color = ''; }
                } catch (e) { if (res) { res.textContent = '❌ ' + e.message; res.style.color = '#dc3545'; } }
            });
        }
    });
})();
