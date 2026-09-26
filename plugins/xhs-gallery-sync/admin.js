(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('xhs-gallery-sync', {
        label: '小红书图集同步',
        render: function (data) {
            data = data || {};
            window.__xgsCreatorId = data.creatorId || '';
            return `
                <div class="form-group">
                    <label>知更地址</label>
                    <input type="text" id="xgs-z-url" value="${window.AdminCMS.esc(data.zhigengUrl || 'http://172.23.0.1:3223')}" placeholder="http://172.23.0.1:3223">
                    <p class="form-help">小红书采集统一由知更（Zhigeng）完成，本插件只消费其内容库。本 CMS 在 Docker bridge 网络内，容器内 127.0.0.1 不是宿主机——默认填 docker 网关地址；连不上时改成 NAS 局域网 IP。</p>
                </div>
                <div class="form-group">
                    <label>知更访问口令</label>
                    <div class="token-field">
                        <input type="password" id="xgs-z-token" value="${window.AdminCMS.esc(data.zhigengToken || '')}" placeholder="知更 data/token.txt 中的口令">
                        <button type="button" class="btn btn--sm" id="xgs-z-toggle">显示</button>
                    </div>
                </div>
                <div class="form-group">
                    <label>监控的小红书博主</label>
                    <div style="display:flex;gap:0.5rem">
                        <select id="xgs-creator" style="flex:1" data-selected="${window.AdminCMS.esc(data.creatorId || '')}">
                            <option value="">全部小红书博主</option>
                        </select>
                        <button type="button" class="btn btn--sm" id="xgs-z-refresh">刷新列表</button>
                    </div>
                    <p class="form-help" id="xgs-z-status">保存后点「刷新列表」从知更拉取博主（需先在知更里添加小红书博主）。</p>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>图集作者名</label>
                        <input type="text" id="xgs-author" value="${window.AdminCMS.esc(data.authorName === undefined ? 'QMQ马倩倩' : data.authorName)}" placeholder="QMQ马倩倩">
                        <p class="form-help">新图集的 author 字段；留空则用知更博主的显示名。</p>
                    </div>
                    <div class="form-group">
                        <label>每轮自动导入上限</label>
                        <input type="number" id="xgs-max" min="1" max="50" value="${window.AdminCMS.esc(data.maxPerRun || 5)}" placeholder="5">
                        <p class="form-help">自动同步单轮最多导入的笔记数；面板「立即同步」不限制。</p>
                    </div>
                    <div class="form-group">
                        <label>每次拉取页数</label>
                        <input type="number" id="xgs-pages" min="1" max="5" value="${window.AdminCMS.esc(data.fetchPages || 2)}" placeholder="2">
                        <p class="form-help">每页 50 条。2 页 = 覆盖知更最新 100 条，检查其中未入库的。</p>
                    </div>
                </div>
                <div class="form-group">
                    <label class="toggle-label">
                        <input type="checkbox" id="xgs-autosync" ${data.autoSync !== false ? 'checked' : ''}> 自动同步（每小时检查一次知更新帖；知更按自身节奏每日采集）
                    </label>
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="xgs-preview">拉取新帖预览</button>
                    <button class="btn btn--ghost btn--sm" id="xgs-apply">立即同步</button>
                    <button class="btn btn--ghost btn--sm" id="xgs-reset">清空已处理记录</button>
                    <span id="xgs-status" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
                <div class="form-group">
                    <p class="form-help" id="xgs-last"></p>
                    <p class="form-help">图片三级来源：知更 R2 模式已直传的外链直接采用 → 知更本地缓存/源站的转存（webp，复用「Cloudflare R2」插件配置）后写入图集。NAS 站即时生效；<b>公共站需手动「导出 + 推送」才会更新</b>。重复导入有双保险：知更 noteId + 存量图集链接比对。</p>
                </div>
            `;
        },
        collect: function () {
            return {
                zhigengUrl: document.getElementById('xgs-z-url') ? document.getElementById('xgs-z-url').value : '',
                zhigengToken: document.getElementById('xgs-z-token') ? document.getElementById('xgs-z-token').value : '',
                creatorId: (function () {
                    const s = document.getElementById('xgs-creator');
                    return s ? (s.dataset.selected || s.value || '') : '';
                })(),
                authorName: document.getElementById('xgs-author') ? document.getElementById('xgs-author').value : '',
                maxPerRun: parseInt(document.getElementById('xgs-max') && document.getElementById('xgs-max').value, 10) || 5,
                fetchPages: parseInt(document.getElementById('xgs-pages') && document.getElementById('xgs-pages').value, 10) || 2,
                autoSync: !!(document.getElementById('xgs-autosync') && document.getElementById('xgs-autosync').checked)
            };
        },
        bind: function () {
            const zToggle = document.getElementById('xgs-z-toggle');
            const zInput = document.getElementById('xgs-z-token');
            if (zToggle && zInput) {
                zToggle.addEventListener('click', () => {
                    const show = zInput.type === 'password';
                    zInput.type = show ? 'text' : 'password';
                    zToggle.textContent = show ? '隐藏' : '显示';
                });
            }

            const statusEl = document.getElementById('xgs-status');
            const lastEl = document.getElementById('xgs-last');
            const show = (msg, isErr) => {
                if (statusEl) { statusEl.textContent = msg; statusEl.style.color = isErr ? '#dc3545' : ''; }
            };

            const collectData = () => ({
                zhigengUrl: document.getElementById('xgs-z-url').value,
                zhigengToken: document.getElementById('xgs-z-token').value,
                creatorId: document.getElementById('xgs-creator').value,
                authorName: document.getElementById('xgs-author').value,
                maxPerRun: parseInt(document.getElementById('xgs-max').value, 10) || 5,
                autoSync: !!document.getElementById('xgs-autosync').checked
            });

            const saveData = () => fetch('/api/plugins/xhs-gallery-sync/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(collectData())
            });

            // 从 CMS 代理拉取知更里的小红书博主列表填充下拉
            const creatorSel0 = document.getElementById('xgs-creator');
            if (creatorSel0) {
                creatorSel0.addEventListener('change', () => { creatorSel0.dataset.selected = creatorSel0.value; });
            }
            const loadCreators = async () => {
                const statusHint = document.getElementById('xgs-z-status');
                try {
                    if (statusHint) statusHint.textContent = '正在连接知更…';
                    // 不 saveData：填充前下拉为空，会覆盖 creatorId
                    const res = await fetch('/api/plugins/xhs-gallery-sync/zhigeng/creators');
                    const json = await res.json();
                    const sel = document.getElementById('xgs-creator');
                    if (!sel) return;
                    if (!res.ok) throw new Error(json.error || '连接失败');
                    sel.innerHTML = '<option value="">全部小红书博主</option>' +
                        (json.creators || []).map(c =>
                            `<option value="${c.id}" ${c.id === (window.__xgsCreatorId || '') ? 'selected' : ''}>${c.name}（${c.status}）</option>`).join('');
                    if (sel.dataset.selected) sel.value = sel.dataset.selected;
                    if (statusHint) {
                        statusHint.textContent = json.creators && json.creators.length
                            ? `知更已连接，${json.creators.length} 个小红书博主`
                            : '知更已连接，但还没有小红书博主（先在知更里添加）';
                    }
                } catch (e) {
                    if (statusHint) statusHint.textContent = '知更连接失败：' + e.message;
                }
            };

            const refreshBtn = document.getElementById('xgs-z-refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', async () => {
                    window.__xgsCreatorId = document.getElementById('xgs-creator') ?
                        document.getElementById('xgs-creator').value : '';
                    await loadCreators();
                });
            }
            loadCreators();

            const previewBtn = document.getElementById('xgs-preview');
            if (previewBtn) {
                previewBtn.addEventListener('click', async () => {
                    try {
                        await saveData();
                        show('从知更拉取中…');
                        const res = await fetch('/api/plugins/xhs-gallery-sync/preview', { method: 'POST' });
                        const json = await res.json();
                        if (res.ok) {
                            show(json.newCount ? '✅ ' + json.message : '未发现新帖');
                            if (lastEl) {
                                lastEl.textContent = json.newCount
                                    ? '待导入：\n' + (json.items || []).map(it => `${it.date} 《${it.title}》（${it.images} 图）`).join('\n')
                                    : '知更最新：' + (json.latest || []).map(w => `${w.date} ${w.title}`).join(' / ') + (json.r2Ready ? '' : '\n⚠️ cloudflare-r2 插件未配置，同步会失败');
                            }
                        } else {
                            show('❌ ' + (json.error || '拉取失败'), true);
                        }
                    } catch (e) {
                        show('❌ ' + e.message, true);
                    }
                });
            }

            const applyBtn = document.getElementById('xgs-apply');
            if (applyBtn) {
                applyBtn.addEventListener('click', async () => {
                    try {
                        await saveData();
                        show('同步中（取图 → R2 → 写图集），请稍候…');
                        const res = await fetch('/api/plugins/xhs-gallery-sync/apply', { method: 'POST' });
                        const json = await res.json();
                        if (res.ok) {
                            show('✅ ' + (json.message || '完成'));
                            if (lastEl) lastEl.textContent = (json.details || []).map(d =>
                                d.status === 'imported' ? `✅ ${d.date} 《${d.title}》→ ${d.albumId}（${d.images} 图）`
                                    : `❌ ${d.title || d.id}：${d.error}`).join('\n') || json.message;
                        } else {
                            show('❌ ' + (json.error || '同步失败'), true);
                        }
                    } catch (e) {
                        show('❌ ' + e.message, true);
                    }
                });
            }

            const resetBtn = document.getElementById('xgs-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', async () => {
                    try {
                        if (!window.confirm('清空已处理记录？存量图集的链接比对仍会防止重复导入。')) return;
                        const res = await fetch('/api/plugins/xhs-gallery-sync/reset', { method: 'POST' });
                        const json = await res.json();
                        if (res.ok) show('✅ ' + (json.message || '已清空'));
                        else show('❌ ' + (json.error || '操作失败'), true);
                    } catch (e) {
                        show('❌ ' + e.message, true);
                    }
                });
            }
        }
    });
})();
