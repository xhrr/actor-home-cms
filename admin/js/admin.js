/**
 * Actor Home CMS — 管理后台
 */
(function () {
    'use strict';

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);
    let config = null;
    let pluginList = [];
    let previewEnabled = false;
    let autosaveTimer = null;
    let dirtySections = new Set();
    let selectedWorkCategory = 0;

    // 页脚固定版权链接：后台只读不可删，配置保存时恒放末位
    const FIXED_FOOTER_LINK = { text: '©杉果派', url: 'https://v.douyin.com/KJbd9GVc17Q/' };

    // 这些插件已有独立后台分区，不在插件面板中重复编辑
    const DEDICATED_PLUGIN_NAMES = ['actor-news', 'actor-awards', 'actor-schedule'];

    const panels = {};

    window.AdminCMS = {
        panels,
        esc: function (str) {
            if (typeof str !== 'string') return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        },
        registerPluginPanel: function (name, panel) {
            panels[name] = panel;
        }
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        config = await (await fetch('/api/config')).json();
        const pluginRes = await fetch('/api/plugins');
        const pluginData = await pluginRes.json();
        pluginList = pluginData.plugins || [];

        renderAll();
        await loadPluginAdminScripts();
        renderPlugins();
        renderExportPluginActions();
        updateSidebarNav();
        loadReadmeEditor();
        bindGlobal();
    }

    /* ===================================================================
       渲染
       =================================================================== */

    function renderAll() {
        renderActor();
        renderHero();
        renderWorks();
        renderGallery();
        renderNews();
        renderAwards();
        renderSchedule();
        renderAbout();
        renderSocial();
        renderFooter();
        renderModules();
        renderPlugins();
        renderMedia();
        renderThemes();
    }

    function findModule(type) {
        return (config.modules || []).find(m => m.type === type);
    }

    function setModuleVisible(type, enabled) {
        const mod = findModule(type);
        if (mod) mod.visible = !!enabled;
        return mod;
    }

    function renderActor() {
        const actor = config.actor || {};
        $('#actor-name').value = actor.name || '';
        $('#actor-nameEn').value = actor.nameEn || '';
        $('#actor-tagline').value = actor.tagline || '';
        $('#actor-avatar').value = actor.avatar || '';
        $('#actor-cover').value = actor.cover || '';
    }

    function renderHero() {
        const hero = config.hero || {};
        const mode = hero.mode || 'classic';
        $('#hero-mode').value = mode;
        const heroMod = findModule('hero');
        const splitMod = findModule('hero-split');
        const heroEnabled = (heroMod && heroMod.visible !== false) || (splitMod && splitMod.visible !== false);
        const heroEnabledInput = $('#hero-enabled');
        if (heroEnabledInput) heroEnabledInput.checked = !!heroEnabled;
        $('#hero-image').value = hero.image || '';
        $('#hero-scroll').value = hero.scrollHint || '';
        $('#hero-split-images').value = (splitMod && splitMod.images || []).join('\n');
        toggleHeroSplitFields();
    }

    function toggleHeroSplitFields() {
        const mode = $('#hero-mode') ? $('#hero-mode').value : 'classic';
        const fields = $('#hero-split-fields');
        if (fields) fields.style.display = mode === 'split' ? '' : 'none';
    }

    function renderFooter() {
        const footer = config.footer || {};
        const footerEnabledInput = $('#footer-enabled');
        if (footerEnabledInput) footerEnabledInput.checked = findModule('footer') ? findModule('footer').visible !== false : true;
        $('#footer-copyright').value = footer.copyright || '';
        const disclaimerInput = $('#footer-disclaimer');
        if (disclaimerInput) disclaimerInput.value = footer.disclaimer || '';

        const links = Array.isArray(footer.links) ? footer.links : [];
        const container = $('#footer-links-list');
        if (!container) return;
        container.innerHTML = links.map((link, i) => {
            const fixed = link && link.text === FIXED_FOOTER_LINK.text && link.url === FIXED_FOOTER_LINK.url;
            return `
            <div class="list-item footer-link-item${fixed ? ' is-fixed' : ''}" data-index="${i}">
                <input type="text" data-footer-link-text="${i}" value="${window.AdminCMS.esc(link.text || '')}" placeholder="显示文字" ${fixed ? 'readonly' : ''}>
                <input type="text" data-footer-link-url="${i}" value="${window.AdminCMS.esc(link.url || '')}" placeholder="https://... 跳转链接" ${fixed ? 'readonly' : ''}>
                ${fixed
                    ? '<span class="fixed-badge" title="固定版权声明：©杉果派 → 抖音">固定</span>'
                    : `<button class="btn--danger" data-remove-footer-link="${i}" title="删除版权链接">×</button>`}
            </div>
        `;
        }).join('');
    }

    function renderWorks() {
        const works = config.works || { heading: '', categories: [] };
        if (!Array.isArray(works.categories)) works.categories = [];
        const worksEnabledInput = $('#works-enabled');
        if (worksEnabledInput) worksEnabledInput.checked = findModule('works') ? findModule('works').visible !== false : true;
        $('#works-heading').value = works.heading || '';

        const catSelect = $('#work-category-select');
        if (catSelect) {
            if (selectedWorkCategory >= works.categories.length) selectedWorkCategory = 0;
            catSelect.innerHTML = works.categories.map((cat, ci) =>
                `<option value="${ci}">${window.AdminCMS.esc(cat.name || ('分类 ' + (ci + 1)))}</option>`
            ).join('');
            catSelect.value = String(selectedWorkCategory);
        }

        const panel = $('#work-category-panel');
        if (!panel) return;

        if (!works.categories.length) {
            panel.innerHTML = '<p class="form-help">还没有分类，点击「添加分类」开始配置。</p>';
            return;
        }

        const cat = works.categories[selectedWorkCategory] || { name: '', items: [] };
        panel.innerHTML = `
            <div class="work-category" data-cat-index="${selectedWorkCategory}">
                <div class="work-category__head">
                    <span class="work-category__label">当前分类</span>
                    <input type="text" data-cat-name="${selectedWorkCategory}" value="${window.AdminCMS.esc(cat.name || '')}" placeholder="例如：电视剧">
                </div>
                <div class="work-category__items">
                    ${(cat.items || []).map((item, ii) => renderWorkItem(item, selectedWorkCategory, ii)).join('')}
                </div>
                <button class="btn btn--ghost btn--sm" data-add-work="${selectedWorkCategory}">+ 添加作品</button>
            </div>
        `;
    }

    function renderWorkItem(item, ci, ii) {
        const key = ci + '-' + ii;
        return `
            <div class="work-item admin-work-item" data-work-key="${key}">
                <div class="work-item__head">
                    <span class="work-item__name">${window.AdminCMS.esc(item.title || ('作品 ' + (ii + 1)))}</span>
                    <button class="btn--danger" data-remove-work="${key}" title="删除作品">×</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>标题</label>
                        <input type="text" data-w-title="${key}" value="${window.AdminCMS.esc(item.title || '')}" placeholder="例如：无声证词">
                    </div>
                    <div class="form-group">
                        <label>角色</label>
                        <input type="text" data-w-role="${key}" value="${window.AdminCMS.esc(item.role || '')}" placeholder="饰演角色">
                    </div>
                    <div class="form-group">
                        <label>上映时间</label>
                        <input type="text" data-w-year="${key}" value="${window.AdminCMS.esc(item.year || item.releaseDate || '')}" placeholder="2024 或 2024-05-01">
                        <p class="form-help">作品将按上映时间倒序展示（新的在前）</p>
                    </div>
                    <div class="form-group">
                        <label>类型</label>
                        <input type="text" data-w-type="${key}" value="${window.AdminCMS.esc(item.type || '')}" placeholder="电视剧 / 电影 / 短剧 / 影游">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>导演</label>
                        <input type="text" data-w-director="${key}" value="${window.AdminCMS.esc(item.director || '')}" placeholder="导演姓名">
                    </div>
                    <div class="form-group">
                        <label>海报 URL</label>
                        <input type="text" data-w-poster="${key}" value="${window.AdminCMS.esc(item.poster || item.image || '')}" placeholder="https://example.com/poster.jpg">
                    </div>
                </div>
                <div class="form-group">
                    <label>原始链接</label>
                    <input type="text" data-w-source="${key}" value="${window.AdminCMS.esc(item.sourceUrl || '')}" placeholder="https://weibo.com/... 或豆瓣/官方页面">
                    <p class="form-help">图集页会显示「查看原始链接」跳转按钮。</p>
                </div>
                <div class="form-group">
                    <label>简介 / 一句话梗概</label>
                    <textarea data-w-synopsis="${key}" rows="2" placeholder="在层层伪证中寻找真相。">${window.AdminCMS.esc(item.synopsis || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>剧照 / 图集 URL（每行一个）</label>
                    <textarea data-w-images="${key}" rows="3" placeholder="https://example.com/still1.jpg&#10;https://example.com/still2.jpg">${(item.images || []).join('\n')}</textarea>
                </div>
            </div>
        `;
    }

    function renderAbout() {
        const about = config.about || {};
        const actor = config.actor || {};
        const aboutMod = findModule('about');
        $('#about-visible').checked = about.visible !== false && (!aboutMod || aboutMod.visible !== false);
        $('#about-role').value = about.role || actor.title || '';
        $('#about-image').value = about.image || actor.avatar || '';
        $('#about-bio').value = (about.bio && about.bio.length ? about.bio : actor.bio || []).join('\n');
        $('#about-stats').value = (about.stats && about.stats.length ? about.stats : actor.stats || []).map(s => `${s.label}=${s.value}`).join('\n');
    }

    function renderSocial() {
        const links = (config.social && config.social.links) || [];
        $('#social-list').innerHTML = links.map((link, i) => `
            <div class="list-item" data-index="${i}">
                <input type="text" data-social-name="${i}" value="${window.AdminCMS.esc(link.name || '')}" placeholder="名称">
                <input type="text" data-social-url="${i}" value="${window.AdminCMS.esc(link.url || '')}" placeholder="链接">
                <button class="btn--danger" data-remove-social="${i}">×</button>
            </div>
        `).join('');
    }

    function renderGallery() {
        config.gallery = config.gallery || { heading: '写真', albums: [] };
        if (!Array.isArray(config.gallery.albums)) config.gallery.albums = [];
        const galleryEnabledInput = $('#gallery-enabled');
        if (galleryEnabledInput) galleryEnabledInput.checked = findModule('images') ? findModule('images').visible !== false : true;
        $('#gallery-heading').value = config.gallery.heading || '写真';
        $('#gallery-albums-list').innerHTML = config.gallery.albums.map((album, ai) => `
            <div class="album-item admin-album-item" data-album-index="${ai}">
                <div class="album-item__head">
                    <span class="album-item__name">${window.AdminCMS.esc(album.title || ('写真集 ' + (ai + 1)))}</span>
                    <button class="btn--danger" data-remove-album="${ai}" title="删除写真集">×</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>标题</label>
                        <input type="text" data-album-title="${ai}" value="${window.AdminCMS.esc(album.title || '')}" placeholder="例如：城市光影">
                    </div>
                    <div class="form-group">
                        <label>封面 URL</label>
                        <input type="text" data-album-cover="${ai}" value="${window.AdminCMS.esc(album.cover || '')}" placeholder="https://example.com/cover.jpg">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>作者</label>
                        <input type="text" data-album-author="${ai}" value="${window.AdminCMS.esc(album.author || '')}" placeholder="摄影师 / 来源作者">
                    </div>
                    <div class="form-group">
                        <label>原始链接</label>
                        <input type="text" data-album-source="${ai}" value="${window.AdminCMS.esc(album.sourceUrl || '')}" placeholder="https://weibo.com/... 或原图地址">
                        <p class="form-help">详情页会显示「原始链接」跳转按钮。</p>
                    </div>
                </div>
                <div class="form-group">
                    <label>照片 URL（每行一个，可多张）</label>
                    <textarea data-album-images="${ai}" rows="5" placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg">${(album.images || []).join('\n')}</textarea>
                    <p class="form-help">第一张会自动作为默认封面；也可以单独填写上面的封面 URL。</p>
                </div>
            </div>
        `).join('') || '<p class="form-help">还没有写真集，点击右上角「新增写真集」开始。</p>';
    }

    function renderNews() {
        const data = (config.plugins && config.plugins.data && config.plugins.data['actor-news']) || {};
        const newsEnabledInput = $('#news-enabled');
        if (newsEnabledInput) newsEnabledInput.checked = findModule('news') ? findModule('news').visible !== false : true;
        $('#news-heading').value = data.heading || '';
        $('#news-list').innerHTML = (data.items || []).map((item, i) => `
            <div class="content-item admin-content-item" data-index="${i}">
                <div class="content-item__head">
                    <span class="content-item__name">动态 ${i + 1}</span>
                    <button class="btn--danger" data-remove-news="${i}" title="删除动态">×</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>日期</label>
                        <input type="text" data-news-date="${i}" value="${window.AdminCMS.esc(item.date || '')}" placeholder="例如：2026.02">
                    </div>
                    <div class="form-group">
                        <label>标题</label>
                        <input type="text" data-news-title="${i}" value="${window.AdminCMS.esc(item.title || '')}" placeholder="例如：新剧开机">
                    </div>
                </div>
                <div class="form-group">
                    <label>摘要</label>
                    <textarea data-news-summary="${i}" rows="2" placeholder="一句话说明这条动态">${window.AdminCMS.esc(item.summary || '')}</textarea>
                    <label style="margin-top:0.6rem">原始链接</label>
                    <input type="text" data-news-source="${i}" value="${window.AdminCMS.esc(item.sourceUrl || '')}" placeholder="https://weibo.com/... 或新闻来源">
                </div>
            </div>
        `).join('');
    }

    function renderAwards() {
        const data = (config.plugins && config.plugins.data && config.plugins.data['actor-awards']) || {};
        const awardsEnabledInput = $('#awards-enabled');
        if (awardsEnabledInput) awardsEnabledInput.checked = findModule('awards') ? findModule('awards').visible !== false : true;
        $('#awards-heading').value = data.heading || '';
        $('#awards-list').innerHTML = (data.items || []).map((item, i) => `
            <div class="content-item admin-content-item" data-index="${i}">
                <div class="content-item__head">
                    <span class="content-item__name">荣誉 ${i + 1}</span>
                    <button class="btn--danger" data-remove-award="${i}" title="删除荣誉">×</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>年份</label>
                        <input type="text" data-award-year="${i}" value="${window.AdminCMS.esc(item.year || '')}" placeholder="例如：2025">
                    </div>
                    <div class="form-group">
                        <label>奖项名称</label>
                        <input type="text" data-award-name="${i}" value="${window.AdminCMS.esc(item.name || '')}" placeholder="例如：年度突破演员">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>颁奖方</label>
                        <input type="text" data-award-org="${i}" value="${window.AdminCMS.esc(item.org || '')}" placeholder="例如：华语电影盛典">
                    </div>
                    <div class="form-group">
                        <label>关联作品</label>
                        <input type="text" data-award-work="${i}" value="${window.AdminCMS.esc(item.work || '')}" placeholder="例如：岛屿来信">
                    </div>
                </div>
            </div>
        `).join('');
    }

    function renderSchedule() {
        const data = (config.plugins && config.plugins.data && config.plugins.data['actor-schedule']) || {};
        const scheduleEnabledInput = $('#schedule-enabled');
        if (scheduleEnabledInput) scheduleEnabledInput.checked = findModule('schedule') ? findModule('schedule').visible !== false : true;
        $('#schedule-heading').value = data.heading || '';
        $('#schedule-list').innerHTML = (data.items || []).map((item, i) => `
            <div class="content-item admin-content-item" data-index="${i}">
                <div class="content-item__head">
                    <span class="content-item__name">行程 ${i + 1}</span>
                    <button class="btn--danger" data-remove-sched="${i}" title="删除行程">×</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>日期</label>
                        <input type="text" data-sched-date="${i}" value="${window.AdminCMS.esc(item.date || '')}" placeholder="例如：2026.03.12">
                    </div>
                    <div class="form-group">
                        <label>城市</label>
                        <input type="text" data-sched-city="${i}" value="${window.AdminCMS.esc(item.city || '')}" placeholder="例如：上海">
                    </div>
                </div>
                <div class="form-group">
                    <label>事项</label>
                    <input type="text" data-sched-event="${i}" value="${window.AdminCMS.esc(item.event || '')}" placeholder="例如：《无声证词》发布会">
                    <label style="margin-top:0.6rem">原始链接</label>
                    <input type="text" data-sched-source="${i}" value="${window.AdminCMS.esc(item.sourceUrl || '')}" placeholder="https://weibo.com/... 或官方来源">
                </div>
            </div>
        `).join('');
        // 行程公告（微博监控等自动同步，无具体日期）
        const annContainer = $('#schedule-announcements');
        if (annContainer) {
            const announcements = data.announcements || [];
            annContainer.innerHTML = announcements.map((a, i) => `
                <div class="content-item admin-content-item" data-announcement-index="${i}">
                    <div class="content-item__head">
                        <span class="content-item__name">公告（${window.AdminCMS.esc(a.month || '?')} 月）</span>
                        <button class="btn--danger" data-remove-announcement="${i}" title="删除公告">×</button>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>月份</label>
                            <input type="number" min="0" max="12" data-announcement-month="${i}" value="${window.AdminCMS.esc(a.month || '')}" placeholder="1-12">
                        </div>
                        <div class="form-group">
                            <label>原始链接</label>
                            <input type="text" data-announcement-source="${i}" value="${window.AdminCMS.esc(a.sourceUrl || '')}" placeholder="https://m.weibo.cn/status/...">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>公告内容</label>
                        <textarea data-announcement-text="${i}" rows="4">${window.AdminCMS.esc(a.text || '')}</textarea>
                    </div>
                </div>
            `).join('') || '<p class="form-help">暂无公告</p>';
        }
    }

    function renderModules() {
        const modules = config.modules || [];
        const listTypes = ['works', 'news', 'awards', 'schedule', 'images'];
        $('#modules-list').innerHTML = modules.map((mod, i) => {
            const type = mod.type || '';
            const extras = [];
            if (type === 'text') {
                extras.push(`
                    <div class="module-row__fields">
                        <div class="form-group">
                            <label>导航/标签</label>
                            <input type="text" data-module-label="${i}" value="${window.AdminCMS.esc(mod.label || '')}" placeholder="显示在板块上方，也可作为导航文字">
                        </div>
                        <div class="form-group">
                            <label>HTML 内容</label>
                            <textarea data-module-content="${i}" rows="4" placeholder="支持 &lt;p&gt;、&lt;strong&gt;、&lt;em&gt;、&lt;a&gt; 等标签">${window.AdminCMS.esc(mod.content || '')}</textarea>
                            <p class="form-help">可粘贴纯文本，也可使用简单 HTML 排版。</p>
                        </div>
                    </div>
                `);
            }
            if (type === 'images') {
                const isPrimaryImages = config.modules.findIndex(m => m.type === 'images') === i;
                if (isPrimaryImages) {
                    extras.push(`
                        <div class="module-row__fields">
                            <p class="form-help">主写真图集请在左侧「写真/图集」分区编辑。</p>
                        </div>
                    `);
                } else {
                    extras.push(`
                        <div class="module-row__fields">
                            <div class="form-group">
                                <label>标题</label>
                                <input type="text" data-module-label="${i}" value="${window.AdminCMS.esc(mod.label || '')}" placeholder="例如：写真 / 现场片段">
                            </div>
                            <div class="form-group">
                                <label>布局</label>
                                <select data-module-layout="${i}">
                                    <option value="grid" ${mod.layout === 'grid' ? 'selected' : ''}>grid</option>
                                    <option value="wide" ${mod.layout === 'wide' ? 'selected' : ''}>wide</option>
                                    <option value="single" ${mod.layout === 'single' ? 'selected' : ''}>single</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>图片 URL（每行一个）</label>
                                <textarea data-module-images="${i}" rows="4" placeholder="https://example.com/photo.jpg&#10;https://example.com/photo2.jpg">${(mod.images || []).join('\n')}</textarea>
                            </div>
                        </div>
                    `);
                }
            }
            if (type === 'hero-split') {
                const isPrimaryHeroSplit = config.modules.findIndex(m => m.type === 'hero-split') === i;
                if (isPrimaryHeroSplit) {
                    extras.push(`
                        <div class="module-row__fields">
                            <p class="form-help">主竖切 Hero 请在左侧「首页 Hero」分区编辑。</p>
                        </div>
                    `);
                } else {
                    extras.push(`
                        <div class="module-row__fields">
                            <div class="form-group" style="grid-column: span 3">
                                <label>竖栏图片 URL（每行一个，不限数量）</label>
                                <textarea data-module-hero-images="${i}" rows="4" placeholder="https://example.com/photo.jpg&#10;每行一张，不限数量">${(mod.images || []).join('\n')}</textarea>
                            </div>
                        </div>
                    `);
                }
            }
            if (listTypes.includes(type)) {
                extras.push(`
                    <div class="module-row__fields">
                        <div class="form-group">
                            <label>首页显示数量</label>
                            <input type="number" min="1" data-module-limit="${i}" value="${mod.limit || ''}">
                        </div>
                    </div>
                `);
            }
            return `
                <div class="module-row" data-module-index="${i}">
                    <div class="module-row__main">
                        <span class="module-row__type">${window.AdminCMS.esc(type)}</span>
                        <label>
                            <input type="checkbox" data-module-visible="${i}" ${mod.visible === false ? '' : 'checked'}> 显示
                        </label>
                        <div class="module-row__controls">
                            <button class="btn btn--sm ${i === 0 ? 'disabled' : ''}" data-module-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
                            <button class="btn btn--sm ${i === modules.length - 1 ? 'disabled' : ''}" data-module-down="${i}" ${i === modules.length - 1 ? 'disabled' : ''}>↓</button>
                            <button class="btn btn--sm btn--danger-text" data-module-delete="${i}" title="删除">×</button>
                        </div>
                    </div>
                    ${extras.join('')}
                </div>
            `;
        }).join('');
    }

    async function loadPluginAdminScripts() {
        const enabled = (config.plugins && config.plugins.enabled) || [];
        const tasks = enabled.map(name => {
            return new Promise((resolve) => {
                const src = `/plugins/${encodeURIComponent(name)}/admin.js`;
                const existing = document.querySelector(`script[src="${src}"]`);
                if (existing) return resolve();
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = () => { console.warn('admin plugin load fail', name); resolve(); };
                document.body.appendChild(script);
            });
        });
        await Promise.all(tasks);
    }

    function renderPlugins() {
        const container = $('#plugins-list');
        if (!container) return;
        const enabled = (config.plugins && config.plugins.enabled) || [];

        container.innerHTML = pluginList.map(plugin => {
            const isEnabled = enabled.includes(plugin.name);
            const panel = panels[plugin.name];
            const data = (config.plugins && config.plugins.data && config.plugins.data[plugin.name]) || {};
            return `
                <div class="plugin-card" data-plugin="${plugin.name}">
                    <div class="plugin-card__header">
                        <h4 class="plugin-card__title">${window.AdminCMS.esc(plugin.manifest.label || plugin.name)} <small>${window.AdminCMS.esc(plugin.manifest.version || '')}</small></h4>
                        <button class="btn btn--sm" data-toggle-plugin="${plugin.name}">${isEnabled ? '停用' : '启用'}</button>
                    </div>
                    <p class="plugin-card__desc">${window.AdminCMS.esc(plugin.manifest.description || '')}</p>
                    ${panel && isEnabled && !DEDICATED_PLUGIN_NAMES.includes(plugin.name) ? `
                        <div class="plugin-panel" data-plugin-panel="${plugin.name}">
                            ${panel.render ? panel.render(data) : ''}
                        </div>
                        <div class="plugin-panel__actions">
                            <button type="button" class="btn btn--primary btn--sm" data-save-plugin="${plugin.name}">保存配置</button>
                            <span class="plugin-panel__status" data-plugin-save-status="${plugin.name}"></span>
                        </div>
                    ` : ''}
                    ${isEnabled && DEDICATED_PLUGIN_NAMES.includes(plugin.name) ? `<p class="plugin-card__desc">该插件内容请在左侧「${plugin.manifest.label || ''}」分区编辑。</p>` : ''}
                    ${isEnabled && !panel && !DEDICATED_PLUGIN_NAMES.includes(plugin.name) ? `<p class="plugin-card__desc">该插件没有提供后台面板，仍可通过 JSON 数据文件管理。</p>` : ''}
                </div>
            `;
        }).join('');

        // 绑定插件面板内部事件
        pluginList.forEach(plugin => {
            const panel = panels[plugin.name];
            if (panel && panel.bind && enabled.includes(plugin.name) && !DEDICATED_PLUGIN_NAMES.includes(plugin.name)) {
                panel.bind();
            }
        });
    }

    /* ===================================================================
       收集
       =================================================================== */

    /* ===================================================================
       分区保存：每个分区独立收集、独立提交，互不影响
       sections —— PATCH /api/config 的顶层字段（对象深合并）
       modules  —— 随分区一起提交完整模块数组（整体替换）
       plugin   —— 该分区内容存到插件 plugins.data[name]（独立端点）
       =================================================================== */

    const SECTION_SAVERS = {
        actor:    { sections: ['actor'], collect: collectActor },
        hero:     { sections: ['hero'], modules: true, collect: function () { collectHero(); if (applyHeroMode()) renderModules(); } },
        works:    { sections: ['works'], modules: true, collect: collectWorks },
        gallery:  { sections: ['gallery'], modules: true, collect: collectGallery },
        news:     { plugin: 'actor-news', modules: true, collect: collectNews },
        awards:   { plugin: 'actor-awards', modules: true, collect: collectAwards },
        schedule: { plugin: 'actor-schedule', modules: true, collect: collectSchedule },
        about:    { sections: ['about'], modules: true, collect: collectAbout },
        social:   { sections: ['social'], collect: collectSocial },
        footer:   { sections: ['footer'], modules: true, collect: collectFooter },
        modules:  { modules: true, collect: collectModules },
        // 插件面板：每个面板数据走各自独立端点（plugins.data[name]），互不影响
        plugins:  { plugins: true }
    };

    // 保存所有非专属插件面板的配置（幂等；无面板/未启用自动跳过）
    async function savePluginPanels() {
        const enabled = (config.plugins && config.plugins.enabled) || [];
        const failed = [];
        for (const name of enabled) {
            if (DEDICATED_PLUGIN_NAMES.includes(name)) continue;
            const panel = panels[name];
            if (!panel || typeof panel.collect !== 'function') continue;
            if (!document.querySelector(`[data-plugin-panel="${name}"]`)) continue;
            try {
                const res = await fetch('/api/plugins/' + encodeURIComponent(name) + '/data', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(panel.collect() || {})
                });
                if (!res.ok) failed.push(name);
            } catch (e) {
                failed.push(name);
            }
        }
        if (!failed.length) {
            // 插件数据不在 PATCH 响应里，单独拉一次最新配置对齐内存
            const fresh = await fetch('/api/config').then(r => r.json()).catch(() => null);
            if (fresh && fresh.plugins) config = fresh;
        }
        return failed.length ? { ok: false, error: '插件配置保存失败: ' + failed.join(', ') } : { ok: true };
    }

    // 只保存指定分区（自动保存用）；成功后刷新内存为服务端最新
    async function saveSection(name, silent = false) {
        if (name === 'plugins') return savePluginPanels();
        const def = SECTION_SAVERS[name];
        if (!def) return { ok: false, error: '未知分区: ' + name };
        if (def.collect) def.collect();

        const sections = {};
        (def.sections || []).forEach(k => {
            if (config[k] !== undefined) sections[k] = config[k];
        });
        const hasPatch = Object.keys(sections).length > 0 || (def.modules && Array.isArray(config.modules));

        // 内容型插件数据（动态/荣誉/行程）走插件独立端点
        if (def.plugin) {
            const data = (config.plugins && config.plugins.data && config.plugins.data[def.plugin]) || {};
            const pres = await fetch('/api/plugins/' + def.plugin + '/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data || {})
            });
            if (!pres.ok) return { ok: false, error: def.plugin + ' 数据保存失败（' + pres.status + '）' };
        }

        if (!hasPatch) return { ok: true, nothing: true };

        const body = { sections };
        if (def.modules) body.modules = config.modules;
        const res = await fetch('/api/config', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            const json = await res.json().catch(() => null);
            if (json && json.config) config = json.config; // 内存与服务端对齐，杜绝旧快照覆盖
            return { ok: true };
        }
        // 兼容旧服务端（尚无 PATCH 端点）：回退整包保存
        if (res.status === 404) {
            const legacy = await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            return legacy.ok ? { ok: true, degraded: true } : { ok: false, error: '保存失败（' + legacy.status + '）' };
        }
        const data = await res.json().catch(() => ({}));
        return { ok: false, error: data.error || ('保存失败（' + res.status + '）') };
    }

    // 「保存修改」：全部分区依次独立保存，任意分区失败不影响其他分区
    async function saveAllSections(silent = false) {
        const failed = [];
        for (const name of Object.keys(SECTION_SAVERS)) {
            const r = await saveSection(name, true);
            if (!r.ok) failed.push(name + ': ' + (r.error || '失败'));
        }
        dirtySections.clear();
        const status = $('#saveStatus');
        if (failed.length) {
            if (!silent) showToast(failed.join('；'), true);
        } else {
            if (!silent) showToast('全部保存成功');
            if (status) {
                status.textContent = '已保存';
                status.classList.add('show');
                setTimeout(() => status.classList.remove('show'), 2000);
            }
        }
        updateSidebarNav();
        if (previewEnabled) refreshPreview();
    }

    function collectActor() {
        config.actor = config.actor || {};
        config.actor.name = $('#actor-name').value;
        config.actor.nameEn = $('#actor-nameEn').value;
        config.actor.tagline = $('#actor-tagline').value;
        config.actor.avatar = $('#actor-avatar').value;
        config.actor.cover = $('#actor-cover').value;
    }

    function collectWorks() {
        config.works = config.works || { heading: '', categories: [] };
        config.works.heading = $('#works-heading').value;
        const worksEnabledInput = $('#works-enabled');
        if (worksEnabledInput) setModuleVisible('works', worksEnabledInput.checked);

        // 只收集当前选中的分类，其他分类保持原样
        const catEl = document.querySelector('#work-category-panel .work-category');
        if (catEl && config.works.categories[selectedWorkCategory]) {
            const ci = selectedWorkCategory;
            const nameInput = catEl.querySelector(`[data-cat-name="${ci}"]`);
            if (nameInput) config.works.categories[ci].name = nameInput.value;
            const items = [];
            catEl.querySelectorAll('.work-item').forEach(item => {
                const key = item.dataset.workKey;
                const [, iIdx] = key.split('-').map(Number);
                const original = config.works.categories[ci].items[iIdx] || {};
                items.push(Object.assign({}, original, {
                    title: item.querySelector(`[data-w-title="${key}"]`).value,
                    role: item.querySelector(`[data-w-role="${key}"]`).value,
                    year: item.querySelector(`[data-w-year="${key}"]`).value,
                    type: item.querySelector(`[data-w-type="${key}"]`).value,
                    director: item.querySelector(`[data-w-director="${key}"]`).value,
                    poster: item.querySelector(`[data-w-poster="${key}"]`).value,
                    sourceUrl: item.querySelector(`[data-w-source="${key}"]`).value,
                    synopsis: item.querySelector(`[data-w-synopsis="${key}"]`).value,
                    images: item.querySelector(`[data-w-images="${key}"]`).value.split('\n').map(s => s.trim()).filter(Boolean)
                }));
            });
            config.works.categories[ci].items = items;
        }
    }

    function collectAbout() {
        config.about = config.about || {};
        config.about.visible = $('#about-visible').checked;
        setModuleVisible('about', $('#about-visible').checked);
        config.about.role = $('#about-role').value;
        config.about.image = $('#about-image').value;
        config.about.bio = $('#about-bio').value.split('\n').filter(s => s.trim());
        config.about.stats = $('#about-stats').value.split('\n').filter(s => s.trim()).map(line => {
            const [label, value] = line.split('=').map(s => s.trim());
            return { label: label || '', value: value || '' };
        });
    }

    function collectSocial() {
        config.social = config.social || { links: [] };
        const links = [];
        document.querySelectorAll('#social-list .list-item').forEach(item => {
            const i = item.dataset.index;
            links.push({
                name: item.querySelector(`[data-social-name="${i}"]`).value,
                url: item.querySelector(`[data-social-url="${i}"]`).value
            });
        });
        config.social.links = links;
    }

    function collectHero() {
        config.hero = config.hero || {};
        config.hero.mode = $('#hero-mode').value;
        config.hero.image = $('#hero-image').value;
        config.hero.scrollHint = $('#hero-scroll').value;
        const heroEnabledInput = $('#hero-enabled');
        if (heroEnabledInput && !heroEnabledInput.checked) {
            const heroMod = findModule('hero');
            const splitMod = findModule('hero-split');
            if (heroMod) heroMod.visible = false;
            if (splitMod) splitMod.visible = false;
        }
    }

    function collectFooter() {
        config.footer = config.footer || {};
        config.footer.copyright = $('#footer-copyright').value;
        const disclaimerInput = $('#footer-disclaimer');
        if (disclaimerInput) config.footer.disclaimer = disclaimerInput.value;
        const footerEnabledInput = $('#footer-enabled');
        if (footerEnabledInput) setModuleVisible('footer', footerEnabledInput.checked);

        const links = [];
        document.querySelectorAll('#footer-links-list .footer-link-item').forEach(item => {
            const i = item.dataset.index;
            const text = item.querySelector(`[data-footer-link-text="${i}"]`).value.trim();
            const url = item.querySelector(`[data-footer-link-url="${i}"]`).value.trim();
            if (!text && !url) return;
            links.push({ text, url });
        });
        // 去掉与固定条重复的条目；固定条恒在末位
        const filtered = links.filter(l => !(l.text === FIXED_FOOTER_LINK.text && l.url === FIXED_FOOTER_LINK.url));
        filtered.push({ ...FIXED_FOOTER_LINK });
        config.footer.links = filtered;
    }

    function collectGallery() {
        config.gallery = config.gallery || { heading: '写真', albums: [] };
        config.gallery.heading = $('#gallery-heading').value;
        const galleryEnabledInput = $('#gallery-enabled');
        if (galleryEnabledInput) setModuleVisible('images', galleryEnabledInput.checked);
        const albums = [];
        document.querySelectorAll('#gallery-albums-list .album-item').forEach(item => {
            const ai = item.dataset.albumIndex;
            const images = item.querySelector(`[data-album-images="${ai}"]`).value.split('\n').map(s => s.trim()).filter(Boolean);
            albums.push({
                title: item.querySelector(`[data-album-title="${ai}"]`).value,
                cover: item.querySelector(`[data-album-cover="${ai}"]`).value || images[0] || '',
                author: item.querySelector(`[data-album-author="${ai}"]`).value,
                sourceUrl: item.querySelector(`[data-album-source="${ai}"]`).value,
                images
            });
        });
        config.gallery.albums = albums;
    }

    async function renderThemes() {
        try {
            const res = await fetch('/api/themes');
            const data = await res.json();
            const container = $('#theme-list');
            if (!container) return;
            const active = data.active;
            const items = [
                {
                    name: '__default__',
                    label: 'Editorial（内置默认）',
                    description: '编辑杂志风默认主题，无需上传。',
                    builtin: true,
                    isActive: !active
                }
            ].concat((data.themes || []).map(t => Object.assign({}, t, { isActive: active === t.name })));

            container.innerHTML = items.map(t => `
                <div class="theme-card${t.isActive ? ' is-active' : ''}">
                    <div class="theme-card__head">
                        <h4 class="theme-card__title">${window.AdminCMS.esc(t.label || t.name)} <small>${t.builtin ? '内置' : window.AdminCMS.esc(t.name)}</small></h4>
                        <span class="theme-card__status">${t.isActive ? '使用中' : ''}</span>
                    </div>
                    <p class="theme-card__desc">${window.AdminCMS.esc(t.description || '')}</p>
                    <p class="theme-card__meta">${t.builtin ? '' : (t.hasHtml ? '含 index.html ' : '') + (t.hasCss ? '含 css/' : '')}</p>
                    <button class="btn btn--sm ${t.isActive ? 'btn--ghost' : 'btn--primary'}" data-activate-theme="${window.AdminCMS.esc(t.name)}" ${t.isActive ? 'disabled' : ''}>${t.isActive ? '使用中' : '启用'}</button>
                </div>
            `).join('') || '<p class="form-help">暂无主题。</p>';
        } catch (e) {
            console.error('theme load error', e);
        }
    }

    function bindTheme() {
        const input = $('#theme-upload');
        if (input) {
            input.addEventListener('change', async () => {
                if (!input.files.length) return;
                const fd = new FormData();
                fd.append('theme', input.files[0]);
                try {
                    const res = await fetch('/api/themes/upload', { method: 'POST', body: fd });
                    const json = await res.json();
                    if (res.ok) {
                        showToast('✅ 主题上传成功：' + json.name);
                        await renderThemes();
                    } else {
                        showToast(json.error || '主题上传失败', true);
                    }
                } catch (err) {
                    showToast('主题上传失败: ' + err.message, true);
                }
                input.value = '';
            });
        }

        const list = $('#theme-list');
        if (list) {
            list.addEventListener('click', async e => {
                const btn = e.target.closest('[data-activate-theme]');
                if (!btn || btn.disabled) return;
                try {
                    const res = await fetch('/api/themes/' + encodeURIComponent(btn.dataset.activateTheme) + '/activate', { method: 'POST' });
                    const json = await res.json();
                    if (res.ok) {
                        showToast('✅ 已启用主题');
                        await renderThemes();
                    } else {
                        showToast(json.error || '启用失败', true);
                    }
                } catch (err) {
                    showToast('启用失败: ' + err.message, true);
                }
            });
        }
    }

    function collectNews() {
        if (!config.plugins) config.plugins = { enabled: [], data: {} };
        if (!config.plugins.data) config.plugins.data = {};
        const data = config.plugins.data['actor-news'] = config.plugins.data['actor-news'] || { heading: '', items: [] };
        data.heading = $('#news-heading').value;
        const newsEnabledInput = $('#news-enabled');
        if (newsEnabledInput) setModuleVisible('news', newsEnabledInput.checked);
        const items = [];
        document.querySelectorAll('#news-list .content-item').forEach(item => {
            const i = item.dataset.index;
            items.push({
                date: item.querySelector(`[data-news-date="${i}"]`).value,
                title: item.querySelector(`[data-news-title="${i}"]`).value,
                summary: item.querySelector(`[data-news-summary="${i}"]`).value,
                sourceUrl: item.querySelector(`[data-news-source="${i}"]`).value
            });
        });
        data.items = items;
    }

    function collectAwards() {
        if (!config.plugins) config.plugins = { enabled: [], data: {} };
        if (!config.plugins.data) config.plugins.data = {};
        const data = config.plugins.data['actor-awards'] = config.plugins.data['actor-awards'] || { heading: '', items: [] };
        data.heading = $('#awards-heading').value;
        const awardsEnabledInput = $('#awards-enabled');
        if (awardsEnabledInput) setModuleVisible('awards', awardsEnabledInput.checked);
        const items = [];
        document.querySelectorAll('#awards-list .content-item').forEach(item => {
            const i = item.dataset.index;
            items.push({
                year: item.querySelector(`[data-award-year="${i}"]`).value,
                name: item.querySelector(`[data-award-name="${i}"]`).value,
                org: item.querySelector(`[data-award-org="${i}"]`).value,
                work: item.querySelector(`[data-award-work="${i}"]`).value
            });
        });
        data.items = items;
    }

    function collectSchedule() {
        if (!config.plugins) config.plugins = { enabled: [], data: {} };
        if (!config.plugins.data) config.plugins.data = {};
        const data = config.plugins.data['actor-schedule'] = config.plugins.data['actor-schedule'] || { heading: '', items: [] };
        data.heading = $('#schedule-heading').value;
        const scheduleEnabledInput = $('#schedule-enabled');
        if (scheduleEnabledInput) setModuleVisible('schedule', scheduleEnabledInput.checked);
        const items = [];
        document.querySelectorAll('#schedule-list .content-item').forEach(item => {
            const i = item.dataset.index;
            items.push({
                date: item.querySelector(`[data-sched-date="${i}"]`).value,
                city: item.querySelector(`[data-sched-city="${i}"]`).value,
                event: item.querySelector(`[data-sched-event="${i}"]`).value,
                sourceUrl: item.querySelector(`[data-sched-source="${i}"]`).value
            });
        });
        data.items = items;
        // 公告收集
        const announcements = [];
        document.querySelectorAll('#schedule-announcements .content-item').forEach(item => {
            const i = item.dataset.announcementIndex;
            announcements.push({
                month: item.querySelector(`[data-announcement-month="${i}"]`).value,
                text: item.querySelector(`[data-announcement-text="${i}"]`).value,
                sourceUrl: item.querySelector(`[data-announcement-source="${i}"]`).value,
                updatedAt: new Date().toISOString()
            });
        });
        data.announcements = announcements.filter(a => a.text);
    }

    function collectModules() {
        const modules = [];
        document.querySelectorAll('#modules-list .module-row').forEach(row => {
            const idx = parseInt(row.dataset.moduleIndex);
            const original = config.modules[idx] || {};
            const type = row.querySelector('.module-row__type').textContent.trim();
            const visible = row.querySelector(`[data-module-visible="${idx}"]`).checked;
            const updated = Object.assign({}, original, { type, visible, nav: original.nav !== false });
            if (type === 'text') {
                updated.label = row.querySelector(`[data-module-label="${idx}"]`).value;
                updated.content = row.querySelector(`[data-module-content="${idx}"]`).value;
            }
            if (type === 'images') {
                const isPrimaryImages = config.modules.findIndex(m => m.type === 'images') === idx;
                if (!isPrimaryImages) {
                    updated.label = row.querySelector(`[data-module-label="${idx}"]`).value;
                    updated.layout = row.querySelector(`[data-module-layout="${idx}"]`).value;
                    updated.images = row.querySelector(`[data-module-images="${idx}"]`).value.split('\n').map(s => s.trim()).filter(Boolean);
                }
            }
            if (type === 'hero-split') {
                const isPrimaryHeroSplit = config.modules.findIndex(m => m.type === 'hero-split') === idx;
                if (!isPrimaryHeroSplit) {
                    const imagesInput = row.querySelector(`[data-module-hero-images="${idx}"]`);
                    if (imagesInput) updated.images = imagesInput.value.split('\n').map(s => s.trim()).filter(Boolean);
                }
            }
            if (['works', 'news', 'awards', 'schedule', 'images'].includes(type)) {
                const limitInput = row.querySelector(`[data-module-limit="${idx}"]`);
                if (limitInput) updated.limit = parseInt(limitInput.value) || undefined;
            }
            modules.push(updated);
        });
        config.modules = modules;
    }

    function applyHeroMode() {
        const mode = config.hero && config.hero.mode || 'classic';
        let heroMod = config.modules.find(m => m.type === 'hero');
        let splitMod = config.modules.find(m => m.type === 'hero-split');
        let changed = false;

        const heroEnabledInput = $('#hero-enabled');
        if (heroEnabledInput && !heroEnabledInput.checked) {
            if (heroMod) heroMod.visible = false;
            if (splitMod) splitMod.visible = false;
            return false;
        }

        if (mode === 'split') {
            if (!splitMod) {
                splitMod = { type: 'hero-split', visible: true, nav: true, images: [] };
                config.modules.push(splitMod);
                changed = true;
            }
            if (heroMod) heroMod.visible = false;
            splitMod.visible = true;
            splitMod.nav = true;
            const imagesInput = $('#hero-split-images');
            if (imagesInput) {
                splitMod.images = imagesInput.value.split('\n').map(s => s.trim()).filter(Boolean);
            }
        } else {
            if (!heroMod) {
                heroMod = { type: 'hero', visible: true, nav: true };
                config.modules.unshift(heroMod);
                changed = true;
            }
            if (splitMod) splitMod.visible = false;
            heroMod.visible = true;
            heroMod.nav = true;
        }

        return changed;
    }

    /* ===================================================================
       保存与操作
       =================================================================== */

    function showToast(msg, isError = false) {
        const el = $('#saveStatus');
        if (el) {
            el.textContent = msg;
            el.style.color = isError ? '#dc3545' : '#28a745';
            el.classList.add('show');
            setTimeout(() => {
                el.classList.remove('show');
                if (el.textContent === msg) el.textContent = '';
            }, 2500);
        }
        const container = $('#toastContainer');
        if (container) {
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.style.background = isError ? '#dc3545' : '#1A1A1A';
            toast.textContent = msg;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }

    async function togglePlugin(name) {
        await fetch(`/api/plugins/${encodeURIComponent(name)}/toggle`, { method: 'POST' });
        // 重新加载状态与配置
        const res = await fetch('/api/config');
        config = await res.json();
        const pr = await fetch('/api/plugins');
        const pd = await pr.json();
        pluginList = pd.plugins || [];
        await loadPluginAdminScripts();
        renderModules();
        renderPlugins();
        renderExportPluginActions();
    }

    async function exportSite() {
        showToast('导出中…');
        try {
            const res = await fetch('/api/export', { method: 'POST' });
            const data = await res.json();
            if (res.ok) showToast('导出成功');
            else showToast(data.error || '导出失败', true);
        } catch (e) {
            showToast('导出失败: ' + e.message, true);
        }
    }

    /* ===================================================================
       事件绑定
       =================================================================== */

    async function renderMedia() {
        try {
            const res = await fetch('/api/images');
            const data = await res.json();
            const list = $('#media-list');
            if (!list) return;
            list.innerHTML = (data || []).map(img => `
                <div class="media-item${img.remote ? ' media-item--remote' : ''}">
                    <img src="${img.url}" alt="媒体" loading="lazy">
                    <button class="media-item__copy" data-copy="${window.AdminCMS.esc(img.url)}" title="复制链接">⧉</button>
                    <button class="media-item__delete" data-delete="${img.remote ? 'remote/' + encodeURIComponent(img.id) : encodeURIComponent(img.filename)}" title="删除">×</button>
                    <span class="media-item__url"><span class="media-item__tag">${img.remote ? 'R2' : '本地'}</span>${img.url}</span>
                </div>
            `).join('') || '<p>暂无图片，点击右上角上传。</p>';
        } catch (e) {
            console.error('media load error', e);
        }
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        // 非安全上下文（如 http://IP）回退方案
        return new Promise((resolve, reject) => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
            } catch (e) {
                reject(e);
            }
            document.body.removeChild(ta);
        });
    }

    function bindMedia() {
        const input = $('#media-upload');
        if (!input) return;
        input.addEventListener('change', async () => {
            const files = Array.from(input.files || []);
            for (const file of files) {
                const fd = new FormData();
                fd.append('image', file);
                try {
                    await fetch('/api/upload', { method: 'POST', body: fd });
                } catch (e) {
                    console.error('upload error', e);
                }
            }
            input.value = '';
            await renderMedia();
        });

        const list = $('#media-list');
        if (list) {
            list.addEventListener('click', async e => {
                const copyBtn = e.target.closest('[data-copy]');
                if (copyBtn) {
                    try {
                        await copyToClipboard(copyBtn.dataset.copy);
                        showToast('✅ 已复制链接');
                    } catch (err) {
                        showToast('复制失败，请手动选择复制', true);
                    }
                    return;
                }
                const btn = e.target.closest('[data-delete]');
                if (!btn) return;
                try {
                    await fetch('/api/images/' + btn.dataset.delete, { method: 'DELETE' });
                    await renderMedia();
                } catch (err) {
                    console.error('delete error', err);
                }
            });
        }
    }

    function updateSidebarNav() {
        const map = {
            hero: ['hero', 'hero-split'],
            works: ['works'],
            gallery: ['images'],
            news: ['news'],
            awards: ['awards'],
            schedule: ['schedule'],
            about: ['about'],
            footer: ['footer']
        };
        Object.keys(map).forEach(section => {
            const link = document.querySelector(`.sidebar__link[data-section="${section}"]`);
            if (!link) return;
            const enabled = map[section].some(type => {
                const mod = findModule(type);
                return mod && mod.visible !== false;
            });
            // 侧边栏始终显示所有模块，未启用的标记出来，方便重新启用
            link.style.display = '';
            link.classList.toggle('is-disabled', !enabled);
        });
    }

    function switchSection(name) {
        document.querySelectorAll('.section-card').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.sidebar__link').forEach(el => el.classList.remove('active'));

        const section = document.getElementById('section-' + name);
        const link = document.querySelector(`.sidebar__link[data-section="${name}"]`);
        if (section) section.classList.add('active');
        if (link) {
            link.classList.add('active');
            const title = $('#topbarTitle');
            if (title) title.textContent = link.textContent.trim();
        }

        // 移动端自动收起侧边栏
        const sidebar = $('#sidebar');
        const toggle = $('#mobileToggle');
        if (sidebar) sidebar.classList.remove('sidebar--open');
        if (toggle) toggle.classList.remove('mobile-toggle--active');
    }

    function bindSectionNav() {
        document.querySelectorAll('.sidebar__link').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                switchSection(link.dataset.section);
            });
        });

        const toggle = $('#mobileToggle');
        const sidebar = $('#sidebar');
        if (toggle && sidebar) {
            toggle.addEventListener('click', () => {
                const open = sidebar.classList.toggle('sidebar--open');
                toggle.classList.toggle('mobile-toggle--active', open);
            });
        }
    }

    function togglePreview() {
        previewEnabled = !previewEnabled;
        const panel = $('#previewPanel');
        if (!panel) return;
        panel.style.display = previewEnabled ? 'flex' : 'none';
        if (previewEnabled) refreshPreview();
    }

    function refreshPreview() {
        const iframe = $('#previewIframe');
        if (!iframe) return;
        iframe.src = '/?t=' + Date.now();
    }

    function markDirty(section) {
        dirtySections.add(section);
        scheduleAutoSave();
    }

    function scheduleAutoSave() {
        if (!previewEnabled) return;
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(saveDirtySections, 1200);
    }

    // 只自动保存发生过编辑的分区
    async function saveDirtySections() {
        if (!dirtySections.size) return;
        const names = Array.from(dirtySections);
        dirtySections.clear();
        for (const n of names) {
            const r = await saveSection(n, true);
            if (!r.ok) dirtySections.add(n); // 失败保留脏标记，下轮重试
        }
        if (previewEnabled) refreshPreview();
    }

    function bindAutoSave() {
        // 委托监听：模块列表等动态重渲染内容也生效
        document.addEventListener('input', onAutoSaveInput, true);
        document.addEventListener('change', onAutoSaveInput, true);
    }

    function onAutoSaveInput(e) {
        const el = e.target;
        if (el.type === 'file') return;
        const card = el.closest('.section-card');
        if (!card || !card.id) return;
        const section = card.id.replace('section-', '');
        if (SECTION_SAVERS[section]) markDirty(section);
    }

    async function loadReadmeEditor() {
        const editor = $('#readme-editor');
        if (!editor) return;
        try {
            const res = await fetch('/api/readme');
            const data = await res.json();
            editor.value = data.content || '';
        } catch (e) {
            console.error('load readme error', e);
        }
    }

    async function saveReadme() {
        const editor = $('#readme-editor');
        if (!editor) return;
        try {
            const res = await fetch('/api/readme', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: editor.value })
            });
            if (res.ok) showToast('README 已保存');
            else showToast('保存失败', true);
        } catch (e) {
            showToast('保存失败: ' + e.message, true);
        }
    }

    function renderExportPluginActions() {
        const container = $('#export-plugin-actions');
        if (!container) return;
        const enabled = (config.plugins && config.plugins.enabled) || [];
        container.innerHTML = '';
        if (enabled.includes('github-deploy')) {
            container.innerHTML = `<button class="btn btn--ghost" id="btn-github-push">推送到 GitHub</button>`;
            const btn = $('#btn-github-push');
            if (btn) {
                btn.addEventListener('click', async () => {
                    showToast('推送中…');
                    try {
                        const res = await fetch('/api/plugins/github-deploy/push', { method: 'POST' });
                        const data = await res.json();
                        if (res.ok) showToast(data.message || '推送成功');
                        else showToast(data.error || '推送失败', true);
                    } catch (e) {
                        showToast('推送失败: ' + e.message, true);
                    }
                });
            }
        }
    }

    function bindGlobal() {
        bindSectionNav();
        bindMedia();
        bindTheme();
        bindAutoSave();

        $('#btnPreview').addEventListener('click', e => {
            e.preventDefault();
            togglePreview();
        });
        $('#btnRefreshPreview').addEventListener('click', refreshPreview);
        $('#btnClosePreview').addEventListener('click', () => {
            previewEnabled = false;
            const panel = $('#previewPanel');
            if (panel) panel.style.display = 'none';
        });

        $('#btnSave').addEventListener('click', () => saveAllSections(false));
        $('#btn-export').addEventListener('click', exportSite);

        const btnSaveReadme = $('#btn-save-readme');
        if (btnSaveReadme) btnSaveReadme.addEventListener('click', saveReadme);

        // Hero 模式切换时显示/隐藏竖切图片配置
        const heroMode = $('#hero-mode');
        if (heroMode) heroMode.addEventListener('change', toggleHeroSplitFields);

        // 作品：选择分类 / 添加分类 / 删除分类 / 添加作品
        const catSelect = $('#work-category-select');
        if (catSelect) {
            catSelect.addEventListener('change', () => {
                selectedWorkCategory = parseInt(catSelect.value) || 0;
                renderWorks();
            });
        }

        $('#btn-add-work').addEventListener('click', () => {
            config.works = config.works || { heading: '', categories: [] };
            if (!Array.isArray(config.works.categories)) config.works.categories = [];
            config.works.categories.push({ name: '新分类', items: [] });
            selectedWorkCategory = config.works.categories.length - 1;
            renderWorks();
        });

        $('#btn-remove-work-cat').addEventListener('click', () => {
            if (!config.works.categories.length) return;
            if (!confirm('确认删除当前分类？该分类下的作品也会被删除。')) return;
            config.works.categories.splice(selectedWorkCategory, 1);
            if (selectedWorkCategory >= config.works.categories.length) selectedWorkCategory = Math.max(0, config.works.categories.length - 1);
            renderWorks();
        });

        $('#work-category-panel').addEventListener('click', e => {
            const addWork = e.target.closest('[data-add-work]');
            if (addWork) {
                const ci = parseInt(addWork.dataset.addWork);
                if (!config.works.categories[ci]) return;
                config.works.categories[ci].items.push({ title: '', role: '', year: '', type: '', director: '', poster: '', synopsis: '', images: [] });
                renderWorks();
                return;
            }
            const btn = e.target.closest('[data-remove-work]');
            if (!btn) return;
            const [ci, ii] = btn.dataset.removeWork.split('-').map(Number);
            if (!config.works.categories[ci]) return;
            config.works.categories[ci].items.splice(ii, 1);
            renderWorks();
        });

        // 社交
        $('#btn-add-social').addEventListener('click', () => {
            config.social = config.social || { links: [] };
            config.social.links.push({ name: '', url: '' });
            renderSocial();
        });
        $('#social-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove-social]');
            if (!btn) return;
            const idx = parseInt(btn.dataset.removeSocial);
            config.social.links.splice(idx, 1);
            renderSocial();
        });

        // 页脚版权链接：新增插到固定条（末位）之前；固定条不可删除
        $('#btn-add-footer-link').addEventListener('click', () => {
            config.footer = config.footer || {};
            if (!Array.isArray(config.footer.links)) config.footer.links = [];
            const fixedIdx = config.footer.links.findIndex(l => l && l.text === FIXED_FOOTER_LINK.text && l.url === FIXED_FOOTER_LINK.url);
            if (fixedIdx >= 0) config.footer.links.splice(fixedIdx, 0, { text: '', url: '' });
            else config.footer.links.push({ text: '', url: '' });
            renderFooter();
        });
        const footerLinksList = $('#footer-links-list');
        if (footerLinksList) {
            footerLinksList.addEventListener('click', e => {
                const btn = e.target.closest('[data-remove-footer-link]');
                if (!btn) return;
                const links = Array.isArray(config.footer.links) ? config.footer.links : [];
                const idx = parseInt(btn.dataset.removeFooterLink);
                const target = links[idx];
                if (!target) return;
                if (target.text === FIXED_FOOTER_LINK.text && target.url === FIXED_FOOTER_LINK.url) return; // 固定条不可删
                links.splice(idx, 1);
                renderFooter();
            });
        }

        // 写真集
        $('#btn-add-album').addEventListener('click', () => {
            config.gallery = config.gallery || { heading: '写真', albums: [] };
            if (!Array.isArray(config.gallery.albums)) config.gallery.albums = [];
            config.gallery.albums.push({ title: '新写真集', cover: '', images: [] });
            renderGallery();
        });
        $('#gallery-albums-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove-album]');
            if (!btn) return;
            const ai = parseInt(btn.dataset.removeAlbum);
            config.gallery.albums.splice(ai, 1);
            renderGallery();
        });

        // 动态
        $('#btn-add-news').addEventListener('click', () => {
            if (!config.plugins) config.plugins = { enabled: [], data: {} };
            if (!config.plugins.data) config.plugins.data = {};
            const data = config.plugins.data['actor-news'] = config.plugins.data['actor-news'] || { heading: '', items: [] };
            data.items.push({ date: '', title: '', summary: '' });
            renderNews();
        });
        $('#news-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove-news]');
            if (!btn) return;
            const data = (config.plugins && config.plugins.data && config.plugins.data['actor-news']) || { items: [] };
            data.items.splice(parseInt(btn.dataset.removeNews), 1);
            renderNews();
        });

        // 荣誉
        $('#btn-add-awards').addEventListener('click', () => {
            if (!config.plugins) config.plugins = { enabled: [], data: {} };
            if (!config.plugins.data) config.plugins.data = {};
            const data = config.plugins.data['actor-awards'] = config.plugins.data['actor-awards'] || { heading: '', items: [] };
            data.items.push({ year: '', name: '', org: '', work: '' });
            renderAwards();
        });
        $('#awards-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove-award]');
            if (!btn) return;
            const data = (config.plugins && config.plugins.data && config.plugins.data['actor-awards']) || { items: [] };
            data.items.splice(parseInt(btn.dataset.removeAward), 1);
            renderAwards();
        });

        // 行程
        $('#btn-add-schedule').addEventListener('click', () => {
            if (!config.plugins) config.plugins = { enabled: [], data: {} };
            if (!config.plugins.data) config.plugins.data = {};
            const data = config.plugins.data['actor-schedule'] = config.plugins.data['actor-schedule'] || { heading: '', items: [] };
            data.items.push({ date: '', city: '', event: '' });
            renderSchedule();
        });
        $('#schedule-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove-sched]');
            if (!btn) return;
            const data = (config.plugins && config.plugins.data && config.plugins.data['actor-schedule']) || { items: [] };
            data.items.splice(parseInt(btn.dataset.removeSched), 1);
            renderSchedule();
        });
        const annContainer = $('#schedule-announcements');
        if (annContainer) {
            annContainer.addEventListener('click', e => {
                const btn = e.target.closest('[data-remove-announcement]');
                if (!btn) return;
                const data = (config.plugins && config.plugins.data && config.plugins.data['actor-schedule']) || { announcements: [] };
                (data.announcements || []).splice(parseInt(btn.dataset.removeAnnouncement), 1);
                renderSchedule();
            });
        }

        // 新增自定义模块
        $('#btn-add-module').addEventListener('click', () => {
            const type = $('#module-add-type').value;
            const mod = { type, visible: true, nav: true };
            if (type === 'text') {
                mod.label = '自定义文本';
                mod.content = '<p>在这里输入内容</p>';
            } else if (type === 'images') {
                mod.label = '自定义图片';
                mod.layout = 'grid';
                mod.images = [];
                mod.limit = 6;
            } else if (type === 'hero-split') {
                mod.label = '竖切 Hero';
                mod.images = [];
            } else if (['works', 'news', 'awards', 'schedule'].includes(type)) {
                mod.limit = 4;
            }
            config.modules.push(mod);
            renderModules();
        });

        // 模块
        $('#modules-list').addEventListener('click', e => {
            const del = e.target.closest('[data-module-delete]');
            if (del) {
                const idx = parseInt(del.dataset.moduleDelete);
                config.modules.splice(idx, 1);
                renderModules();
                return;
            }
            const up = e.target.closest('[data-module-up]');
            const down = e.target.closest('[data-module-down]');
            if (!up && !down) return;
            const idx = parseInt((up || down).dataset[up ? 'moduleUp' : 'moduleDown']);
            const arr = config.modules;
            if (up && idx > 0) {
                [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
            }
            if (down && idx < arr.length - 1) {
                [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
            }
            renderModules();
        });

        // 插件启停
        $('#plugins-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-toggle-plugin]');
            if (btn) togglePlugin(btn.dataset.togglePlugin);
            const saveBtn = e.target.closest('[data-save-plugin]');
            if (saveBtn) savePluginPanel(saveBtn.dataset.savePlugin);
        });
    }

    // 插件面板「保存配置」：数据走插件独立端点，互不影响
    async function savePluginPanel(name) {
        const panel = panels[name];
        const statusEl = document.querySelector(`[data-plugin-save-status="${name}"]`);
        if (!panel || typeof panel.collect !== 'function') return;
        try {
            const res = await fetch('/api/plugins/' + encodeURIComponent(name) + '/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(panel.collect() || {})
            });
            const json = await res.json().catch(() => ({}));
            if (res.ok) {
                if (statusEl) {
                    statusEl.textContent = '✅ 已保存';
                    statusEl.style.color = '#28a745';
                    setTimeout(() => { if (statusEl.textContent === '✅ 已保存') statusEl.textContent = ''; }, 2500);
                }
            } else {
                if (statusEl) {
                    statusEl.textContent = '❌ ' + (json.error || '保存失败（' + res.status + '）');
                    statusEl.style.color = '#dc3545';
                }
            }
        } catch (e) {
            if (statusEl) {
                statusEl.textContent = '❌ ' + e.message;
                statusEl.style.color = '#dc3545';
            }
        }
    }
})();
