(function () {
    'use strict';
    if (!window.AdminCMS) return;

    // bind() 由后台以普通函数调用（无 this），保存统一走 panel.collect()——
    // 避免内联字段清单与 collect 漂移（漏一个字段保存时会被整体替换抹掉）
    const panel = {
        label: '倩一波日常',
        render: function (data) {
            data = data || {};
            window.__wwCreatorId = data.creatorId || '';
            return `
                <div class="form-group">
                    <label>知更地址</label>
                    <input type="text" id="ww-z-url" value="${window.AdminCMS.esc(data.zhigengUrl === undefined ? 'http://172.23.0.1:3223' : data.zhigengUrl)}" placeholder="http://172.23.0.1:3223">
                    <p class="form-help">微博数据统一由知更（Zhigeng）采集，本插件只消费其内容库。本 CMS 在 Docker bridge 网络内，容器内 127.0.0.1 不是宿主机——默认填 docker 网关地址；连不上时改成 NAS 局域网 IP。留空 = 用默认地址。</p>
                </div>
                <div class="form-group">
                    <label>知更访问口令</label>
                    <div class="token-field">
                        <input type="password" id="ww-z-token" value="${window.AdminCMS.esc(data.zhigengToken || '')}" placeholder="知更 data/token.txt 中的口令">
                        <button type="button" class="btn btn--sm" id="ww-z-toggle">显示</button>
                    </div>
                </div>
                <div class="form-group">
                    <label>监控的微博博主</label>
                    <div style="display:flex;gap:0.5rem">
                        <select id="ww-creator" style="flex:1" data-selected="${window.AdminCMS.esc(data.creatorId || '')}">
                            <option value="">全部微博博主</option>
                        </select>
                        <button type="button" class="btn btn--sm" id="ww-z-refresh">刷新列表</button>
                    </div>
                    <p class="form-help" id="ww-z-status">保存后点「刷新列表」从知更拉取博主（需先在知更里添加微博博主）。</p>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>关键词（逗号分隔）</label>
                        <input type="text" id="ww-keyword" value="${window.AdminCMS.esc(data.keyword === undefined ? '同步,更新' : data.keyword)}" placeholder="同步,更新">
                        <p class="form-help">留空 = 用默认关键词（同步、更新）。清空后点保存即生效。</p>
                    </div>
                    <div class="form-group">
                        <label>月份识别</label>
                        <input type="text" value="自动（同步X月行程）" disabled>
                        <p class="form-help">不再固定「下个月」：插件从每条微博标题「同步X月行程」自动识别目标月份，发布时间不定也能命中（年份按发布时间推断，跨年自动顺延）。</p>
                    </div>
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
                    <div style="margin-top:.5rem;display:flex;align-items:center;gap:.6rem">
                        <button class="btn btn--sm" id="ww-ai-test">测试 AI 连接</button>
                        <span id="ww-ai-status" style="font-size:0.82rem"></span>
                    </div>
                </div>
                <div class="form-group">
                    <label class="toggle-label">
                        <input type="checkbox" id="ww-autosync" ${data.autoSync !== false ? 'checked' : ''}> 自动同步（每小时检查一次知更新帖，命中即解析写入行程）
                    </label>
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="ww-preview">从知更拉取并预览</button>
                    <button class="btn btn--ghost btn--sm" id="ww-apply">解析并应用</button>
                    <span id="ww-status" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
                <div class="form-group">
                    <p class="form-help" id="ww-last"></p>
                </div>
            `;
        },
        collect: function () {
            const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
            return {
                zhigengUrl: g('ww-z-url'),
                zhigengToken: g('ww-z-token'),
                creatorId: g('ww-creator'),
                keyword: g('ww-keyword'),   // 空串 = 用服务端默认关键词，原样保存（勿回退默认值，否则清空永远存不下去）
                llmBaseUrl: g('ww-llm-base'),
                llmModel: g('ww-llm-model'),
                llmKey: g('ww-llm-key'),
                autoSync: !!(document.getElementById('ww-autosync') && document.getElementById('ww-autosync').checked)
            };
        },
        bind: function () {
            const llmToggle = document.getElementById('ww-llm-toggle');
            const llmInput = document.getElementById('ww-llm-key');
            if (llmToggle && llmInput) {
                llmToggle.addEventListener('click', () => {
                    const show = llmInput.type === 'password';
                    llmInput.type = show ? 'text' : 'password';
                    llmToggle.textContent = show ? '隐藏' : '显示';
                });
            }
            const zToggle = document.getElementById('ww-z-toggle');
            const zInput = document.getElementById('ww-z-token');
            if (zToggle && zInput) {
                zToggle.addEventListener('click', () => {
                    const show = zInput.type === 'password';
                    zInput.type = show ? 'text' : 'password';
                    zToggle.textContent = show ? '隐藏' : '显示';
                });
            }

            const statusEl = document.getElementById('ww-status');
            const lastEl = document.getElementById('ww-last');
            const show = (msg, isErr) => {
                if (statusEl) { statusEl.textContent = msg; statusEl.style.color = isErr ? '#dc3545' : ''; }
            };

            // 保存统一走 panel.collect()：字段清单只有一处，空值（空串/0）原样保存
            const saveData = () => fetch('/api/plugins/weibo-watch/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(panel.collect())
            });

            // 从 CMS 代理拉取知更里的微博博主列表填充下拉。
            // ⚠️ 默认不保存（save:true 才先落盘）：首屏自动加载时不写配置，
            // 避免「用户未做任何修改，面板一打开就整体 PUT 覆盖一次」的静默写盘
            const loadCreators = async ({ save } = {}) => {
                const statusHint = document.getElementById('ww-z-status');
                try {
                    if (statusHint) statusHint.textContent = '正在连接知更…';
                    if (save) await saveData();
                    const res = await fetch('/api/plugins/weibo-watch/zhigeng/creators');
                    const json = await res.json();
                    const sel = document.getElementById('ww-creator');
                    if (!sel) return;
                    if (!res.ok) throw new Error(json.error || '连接失败');
                    sel.innerHTML = '<option value="">全部微博博主</option>' +
                        (json.creators || []).map(c =>
                            `<option value="${c.id}" ${String(c.id) === String(sel.dataset.selected || '') ? 'selected' : ''}>${c.name}（${c.status}）</option>`).join('');
                    if (sel.dataset.selected) sel.value = sel.dataset.selected;
                    if (statusHint) {
                        statusHint.textContent = json.creators && json.creators.length
                            ? `知更已连接，${json.creators.length} 个微博博主`
                            : '知更已连接，但还没有微博博主（先在知更里添加）';
                    }
                } catch (e) {
                    if (statusHint) statusHint.textContent = '知更连接失败：' + e.message;
                }
            };

            const refreshBtn = document.getElementById('ww-z-refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', async () => {
                    window.__wwCreatorId = document.getElementById('ww-creator') ?
                        document.getElementById('ww-creator').value : '';
                    await loadCreators({ save: true }); // 主动点刷新：先落盘再连（新填的口令要先生效）
                });
            }
            loadCreators(); // 首屏自动加载：不写盘

            const aiTestBtn = document.getElementById('ww-ai-test');
            if (aiTestBtn) {
                aiTestBtn.addEventListener('click', async () => {
                    const st = document.getElementById('ww-ai-status');
                    try {
                        if (st) { st.textContent = '测试中…'; st.style.color = ''; }
                        await saveData(); // 先保存当前输入的 key 再测
                        const res = await fetch('/api/plugins/weibo-watch/ai-test', { method: 'POST' });
                        const j = await res.json();
                        if (res.ok && j.ok) {
                            if (st) st.textContent = `✅ ${j.model} 连通（${j.ms}ms）「${j.reply}」`;
                        } else if (st) { st.textContent = '❌ ' + (j.error || '失败'); st.style.color = '#dc3545'; }
                    } catch (e) {
                        if (st) { st.textContent = '❌ ' + e.message; st.style.color = '#dc3545'; }
                    }
                });
            }
            const previewBtn = document.getElementById('ww-preview');
            if (previewBtn) {
                previewBtn.addEventListener('click', async () => {
                    try {
                        await saveData();
                        show('从知更拉取中…');
                        const res = await fetch('/api/plugins/weibo-watch/preview', { method: 'POST' });
                        const json = await res.json();
                        if (res.ok) {
                            if (json.hit) {
                                show('✅ 命中行程微博（' + (json.targetMonth || '') + '），解析 ' + (json.hits || []).length + ' 条');
                                if (lastEl) lastEl.textContent = '微博：' + json.weibo.text.slice(0, 80) + '…\n解析：' + (json.items || []).map(it => `${it.date} ${it.city} ${it.event}`).join('；');
                            } else {
                                show('未命中行程微博');
                                if (lastEl) lastEl.textContent = '知更最新微博：' + (json.latest || []).join(' / ');
                            }
                        } else {
                            show('❌ ' + (json.error || '拉取失败'), true);
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
                        show('从知更拉取并解析中…');
                        const res = await fetch('/api/plugins/weibo-watch/apply', { method: 'POST' });
                        const json = await res.json();
                        if (res.ok) {
                            show('✅ ' + (json.message || '完成'));
                            if (lastEl) lastEl.textContent = json.message || '';
                        } else {
                            show('❌ ' + (json.error || '应用失败'), true);
                        }
                    } catch (e) {
                        show('❌ ' + e.message, true);
                    }
                });
            }
        }
    };

    window.AdminCMS.registerPluginPanel('weibo-watch', panel);
})();
