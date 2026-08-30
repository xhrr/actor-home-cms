(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('weibo-watch', {
        label: '微博行程监控',
        render: function (data) {
            data = data || {};
            return `
                <div class="form-row">
                    <div class="form-group">
                        <label>微博 UID</label>
                        <input type="text" id="ww-uid" value="${window.AdminCMS.esc(data.uid || '')}" placeholder="微博主页 URL 中 weibo.com/u/ 后面的数字">
                    </div>
                    <div class="form-group">
                        <label>目标月份</label>
                        <input type="number" id="ww-target" min="0" max="6" value="${window.AdminCMS.esc(data.targetMonth || 1)}" placeholder="1">
                        <p class="form-help">1 = 下个月（月底抓到的“同步X月行程”通常是下个月）</p>
                    </div>
                </div>
                <div class="form-group">
                    <label>浏览器 Cookie</label>
                    <div class="token-field">
                        <input type="password" id="ww-cookie" value="${window.AdminCMS.esc(data.cookie || '')}" placeholder="打开 m.weibo.cn，按 F12 → Network → 复制任意请求的 Cookie 头粘贴到这里">
                        <button type="button" class="btn btn--sm" id="ww-cookie-toggle">显示</button>
                    </div>
                    <p class="form-help">微博无登录接口需要访客/登录 Cookie 才可抓取。Cookie 失效后在后台重新粘贴即可。</p>
                </div>
                <div class="form-group">
                    <label>关键词（逗号分隔）</label>
                    <input type="text" id="ww-keyword" value="${window.AdminCMS.esc(data.keyword || '同步,更新')}" placeholder="同步,更新">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>AI Base URL</label>
                        <input type="text" id="ww-llm-base" value="${window.AdminCMS.esc(data.llmBaseUrl || 'https://api.xiaomimimo.com/v1')}" placeholder="https://api.xiaomimimo.com/v1">
                    </div>
                    <div class="form-group">
                        <label>AI Model</label>
                        <input type="text" id="ww-llm-model" value="${window.AdminCMS.esc(data.llmModel || 'Mimo-V2.5')}" placeholder="Mimo-V2.5">
                    </div>
                </div>
                <div class="form-group">
                    <label>AI Key（行程解析用）</label>
                    <div class="token-field">
                        <input type="password" id="ww-llm-key" value="${window.AdminCMS.esc(data.llmKey || '')}" placeholder="小米 MiMo API Key">
                        <button type="button" class="btn btn--sm" id="ww-llm-toggle">显示</button>
                    </div>
                    <p class="form-help">行程微博正文将交给 AI（小米 MiMo V2.5）解析：自动合并同项目阶段、纠正年份、提取公告。</p>
                </div>
                <div class="form-group">
                    <label class="toggle-label">
                        <input type="checkbox" id="ww-autosync" ${data.autoSync !== false ? 'checked' : ''}> 月底自动同步（25 号后每 6 小时尝试一次）
                    </label>
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="ww-preview">抓取并预览</button>
                    <button class="btn btn--ghost btn--sm" id="ww-apply">解析并应用</button>
                    <span id="ww-status" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
                <div class="form-group">
                    <p class="form-help" id="ww-last"></p>
                </div>
            `;
        },
        collect: function () {
            return {
                uid: document.getElementById('ww-uid') ? document.getElementById('ww-uid').value : '',
                targetMonth: parseInt(document.getElementById('ww-target') && document.getElementById('ww-target').value, 10) || 1,
                cookie: document.getElementById('ww-cookie') ? document.getElementById('ww-cookie').value : '',
                keyword: document.getElementById('ww-keyword') ? document.getElementById('ww-keyword').value : '',
                llmBaseUrl: document.getElementById('ww-llm-base') ? document.getElementById('ww-llm-base').value : '',
                llmModel: document.getElementById('ww-llm-model') ? document.getElementById('ww-llm-model').value : '',
                llmKey: document.getElementById('ww-llm-key') ? document.getElementById('ww-llm-key').value : '',
                autoSync: !!(document.getElementById('ww-autosync') && document.getElementById('ww-autosync').checked)
            };
        },
        bind: function () {
            const cookieToggle = document.getElementById('ww-cookie-toggle');
            const cookieInput = document.getElementById('ww-cookie');
            const llmToggle = document.getElementById('ww-llm-toggle');
            const llmInput = document.getElementById('ww-llm-key');
            if (llmToggle && llmInput) {
                llmToggle.addEventListener('click', () => {
                    const show = llmInput.type === 'password';
                    llmInput.type = show ? 'text' : 'password';
                    llmToggle.textContent = show ? '隐藏' : '显示';
                });
            }
            if (cookieToggle && cookieInput) {
                cookieToggle.addEventListener('click', () => {
                    const show = cookieInput.type === 'password';
                    cookieInput.type = show ? 'text' : 'password';
                    cookieToggle.textContent = show ? '隐藏' : '显示';
                });
            }

            const saveData = () => {
                const data = {
                    uid: document.getElementById('ww-uid').value,
                    targetMonth: parseInt(document.getElementById('ww-target').value, 10) || 1,
                    cookie: document.getElementById('ww-cookie').value,
                    keyword: document.getElementById('ww-keyword').value,
                    llmBaseUrl: document.getElementById('ww-llm-base').value,
                    llmModel: document.getElementById('ww-llm-model').value,
                    llmKey: document.getElementById('ww-llm-key').value,
                    autoSync: !!document.getElementById('ww-autosync').checked
                };
                return fetch('/api/plugins/weibo-watch/data', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            };

            const statusEl = document.getElementById('ww-status');
            const lastEl = document.getElementById('ww-last');
            const show = (msg, isErr) => {
                if (statusEl) { statusEl.textContent = msg; statusEl.style.color = isErr ? '#dc3545' : ''; }
            };

            const previewBtn = document.getElementById('ww-preview');
            if (previewBtn) {
                previewBtn.addEventListener('click', async () => {
                    try {
                        await saveData();
                        show('抓取中…');
                        const res = await fetch('/api/plugins/weibo-watch/preview', { method: 'POST' });
                        const json = await res.json();
                        if (res.ok) {
                            if (json.hit) {
                                const list = (json.items || []).map(it => `${it.dateText} ${it.city} ${it.event}`).join('；');
                                show('✅ 命中行程微博（' + (json.targetMonth || '') + '），解析 ' + (json.items || []).length + ' 条');
                                if (lastEl) lastEl.textContent = '微博：' + json.weibo.text.slice(0, 80) + '…\n解析：' + list;
                            } else {
                                show('未命中行程微博');
                                if (lastEl) lastEl.textContent = '最近微博：' + (json.latest || []).join(' / ');
                            }
                        } else {
                            show('❌ ' + (json.error || '抓取失败'), true);
                        }
                    } catch (e) {
                        show('❌ ' + e.message, true);
                    }
                });
            }

            const applyBtn = document.getElementById('ww-apply');
            if (applyBtn) {
                applyBtn.addEventListener('click', async () => {
                    try {
                        await saveData();
                        show('抓取中…');
                        const res = await fetch('/api/plugins/weibo-watch/apply', { method: 'POST' });
                        const json = await res.json();
                        if (res.ok) {
                            show('✅ ' + (json.message || '完成'));
                            if (lastEl) lastEl.textContent = (json.items || []).map(it => `${it.dateText} ${it.city} ${it.event}`).join('；');
                        } else {
                            show('❌ ' + (json.error || '应用失败'), true);
                        }
                    } catch (e) {
                        show('❌ ' + e.message, true);
                    }
                });
            }
        }
    });
})();