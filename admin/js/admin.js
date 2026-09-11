/**
 * Actor Home CMS — 管理后台
 */
(function () {
    'use strict';

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);
    let config = null;
    let configLoadFailed = false; // 配置加载失败旗标：置位后禁止一切保存（防错误响应体被当作配置误写）
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
            // 数字/布尔等标量也要能回显到输入框（此前非字符串一律返回 ''，
            // 导致插件面板的数字配置项 value 恒为空、保存后又变回默认值）
            if (str === null || str === undefined) return '';
            if (typeof str === 'object') return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        },
        registerPluginPanel: function (name, panel) {
            panels[name] = panel;
        }
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        try {
            const res = await fetch('/api/config');
            config = await res.json();
            if (!res.ok) configLoadFailed = true;
        } catch (e) {
            configLoadFailed = true;
        }
        // migrateConfig 保证正常配置必有 modules 数组；缺失 = 拿到的是错误响应体（如全新环境 ENOENT 500）
        if (!config || typeof config !== 'object' || !Array.isArray(config.modules)) configLoadFailed = true;
        if (configLoadFailed) showToast('配置加载失败，请刷新页面重试', true);
        const pluginRes = await fetch('/api/plugins');
        const pluginData = await pluginRes.json();
        pluginList = pluginData.plugins || [];

        renderAll();
        await loadPluginAdminScripts();
        renderPlugins();
        renderExportPluginActions();
        updateSidebarNav();
        loadReadmeEditor();
        renderCommentsAdmin();
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
        renderFanGroups();
        renderModules();
        renderPlugins();
        renderMedia();
        renderThemes();
    }

    function findModule(type) {
        return (config.modules || []).find(m => m.type === type);
    }

    function setModuleVisible(type, enabled) {
        const idx = (config.modules || []).findIndex(m => m.type === type);
        if (idx < 0) return undefined;
        config.modules[idx].visible = !!enabled;
        // 双向同步两处勾选（分区开关 ↔ 模块管理卡片）：collectModules 会从卡片 DOM
        // 重建整个数组，不同步的话分区开关的状态会在保存时被卡片旧勾选覆盖回去
        const sectionInput = $(`#${type}-enabled`);
        if (sectionInput && sectionInput.checked !== !!enabled) sectionInput.checked = !!enabled;
        const cardInput = document.querySelector(`#modules-list [data-module-visible="${idx}"]`);
        if (cardInput && cardInput.checked !== !!enabled) cardInput.checked = !!enabled;
        return config.modules[idx];
    }

    // 启用开关旁的实时状态提示：空内容时站点渲染器不渲染板块，避免「启用了却没变化」的困惑
    function updateEnableHint(type) {
        const map = {
            news: ['news-enabled', 'news-enabled-hint', 'actor-news'],
            awards: ['awards-enabled', 'awards-enabled-hint', 'actor-awards'],
            schedule: ['schedule-enabled', 'schedule-enabled-hint', 'actor-schedule']
        }[type] || [];
        const input = map[0] && $(map[0]);
        const el = map[1] && $(map[1]);
        if (!input || !el) return;
        const data = (config.plugins && config.plugins.data && config.plugins.data[map[2]]) || {};
        const count = (data.items || []).length;
        if (!input.checked) el.textContent = '已停用：首页不显示此模块';
        else if (!count) el.textContent = '已启用，但还没有内容条目——先在下方新增条目，首页才会显示';
        else el.textContent = `已启用：首页按时间显示最新 ${count} 条`;
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
        $('#hero-split-images').value = (splitMod && splitMod.images || []).join('\n');
        // 移动端专属图：按当前模式回填对应模块的配置
        const activeMod = mode === 'split' ? (splitMod || {}) : (heroMod || {});
        const por = $('#hero-mobile-portrait');
        const land = $('#hero-mobile-landscape');
        if (por) por.value = (activeMod.imagesMobilePortrait || []).join('\n');
        if (land) land.value = (activeMod.imagesMobileLandscape || []).join('\n');
        toggleHeroSplitFields();
    }

    // 移动端专属图写入当前活动模块（hero / hero-split）
    function applyHeroMobileFields() {
        const mode = config.hero && config.hero.mode || 'classic';
        const mod = findModule(mode === 'split' ? 'hero-split' : 'hero');
        if (!mod) return;
        const por = $('#hero-mobile-portrait');
        const land = $('#hero-mobile-landscape');
        if (!por || !land) return;
        const parse = v => v.split('\n').map(s => s.trim()).filter(Boolean);
        mod.imagesMobilePortrait = parse(por.value);
        mod.imagesMobileLandscape = parse(land.value);
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
                    ? '<span class="fixed-badge" title="固定版权声明：©杉果派 → 悬停弹制作组，点击跳抖音">固定</span>'
                    : `<button class="btn--danger" data-remove-footer-link="${i}" title="删除版权链接">×</button>`}
            </div>
        `;
        }).join('');

        // 制作组成员（悬停「©杉果派」弹出）
        const credits = footer.credits || { members: [] };
        const creditsTitleInput = $('#footer-credits-title');
        if (creditsTitleInput) creditsTitleInput.value = credits.title || '制作组';
        const creditsList = $('#footer-credits-list');
        if (creditsList) {
            creditsList.innerHTML = (Array.isArray(credits.members) ? credits.members : []).map((m, i) => `
                <div class="list-item credit-member-item" data-index="${i}">
                    <input type="text" data-credit-name="${i}" value="${window.AdminCMS.esc((m && m.name) || '')}" placeholder="姓名">
                    <input type="text" data-credit-role="${i}" value="${window.AdminCMS.esc((m && m.role) || '')}" placeholder="职务/角色">
                    <input type="text" data-credit-link="${i}" value="${window.AdminCMS.esc((m && m.link) || '')}" placeholder="https://... 个人主页（可选）">
                    <button class="btn--danger" data-remove-credit="${i}" title="删除成员">×</button>
                </div>
            `).join('');
        }
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
        const catName = (config.works.categories[ci] && config.works.categories[ci].name) || '';
        const searchText = [item.title, item.role, item.director, item.year, item.type, item.synopsis, catName].join(' ').toLowerCase();
        const meta = [catName, item.year, (item.type || '') + (item.role ? ' · 饰 ' + item.role : '')].filter(Boolean).join(' · ');
        return `
            <div class="work-item admin-work-item is-collapsed" data-work-key="${key}" data-search="${window.AdminCMS.esc(searchText)}">
                <div class="work-item__head" data-toggle-item>
                    <span class="work-item__name">${window.AdminCMS.esc(item.title || ('作品 ' + (ii + 1)))}</span>
                    <span class="item-meta">${window.AdminCMS.esc(meta)}</span>
                    <span class="item-tools">
                        <button class="btn--danger" data-remove-work="${key}" title="删除作品">×</button>
                        <span class="collapse-chevron">▾</span>
                    </span>
                </div>
                <div class="work-item__body">
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

    /* ---------- 写真集分页渲染 ----------
     * 图集可达数百个：每个条目含 6 个表单字段，全量渲染会产生上千个输入控件（实测 320 条约 945KB HTML、
     * 1900+ 字段），后台打开与操作都很卡顿。改为「分页渲染 + 按需加载更多」。
     * ⚠️ 收集（保存）不能用「遍历已渲染条目」——未渲染的会被丢掉。改为以 config.gallery.albums 为底，
     *    已渲染条目用 DOM 覆盖，其余保留原值（见 collectGallery）。 */
    const ALBUM_PAGE = 50;              // 每页条数
    let galleryPageCount = 1;           // 当前已渲染页数
    let galleryFilterQuery = '';        // 分区搜索词（用于分页过滤，见 bindListControls）

    function albumItemHtml(album, ai) {
        const src = [album.title, album.author, album.sourceUrl, album.date, (album.images || []).length + '张'].join(' ').toLowerCase();
        const meta = [album.date, album.author, (album.images || []).length + ' 张'].filter(Boolean).join(' · ');
        return `
            <div class="album-item admin-album-item is-collapsed" data-album-index="${ai}" data-search="${window.AdminCMS.esc(src)}">
                <div class="album-item__head" data-toggle-item>
                    <span class="album-item__name">${window.AdminCMS.esc(album.title || ('写真集 ' + (ai + 1)))}</span>
                    <span class="item-meta">${window.AdminCMS.esc(meta)}</span>
                    <span class="item-tools">
                        <button class="btn--danger" data-remove-album="${ai}" title="删除写真集">×</button>
                        <span class="collapse-chevron">▾</span>
                    </span>
                </div>
                <div class="album-item__body">
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
                        <label>发帖日期（年月日）</label>
                        <input type="date" data-album-date="${ai}" value="${window.AdminCMS.esc(album.date || '')}">
                        <p class="form-help">取原始链接的发布时间；图集页按月筛选与排序依据。</p>
                    </div>
                    <div class="form-group">
                        <label>作者</label>
                        <input type="text" data-album-author="${ai}" value="${window.AdminCMS.esc(album.author || '')}" placeholder="摄影师 / 来源作者">
                    </div>
                </div>
                <div class="form-group">
                    <label>原始链接</label>
                    <input type="text" data-album-source="${ai}" value="${window.AdminCMS.esc(album.sourceUrl || '')}" placeholder="https://weibo.com/... 或原图地址">
                    <p class="form-help">详情页会显示「原始链接」跳转按钮。</p>
                </div>
                <div class="form-group">
                    <label>照片 URL（每行一个，可多张）</label>
                    <textarea data-album-images="${ai}" rows="5" placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg">${(album.images || []).join('\n')}</textarea>
                    <p class="form-help">第一张会自动作为默认封面；也可以单独填写上面的封面 URL。</p>
                </div>
                </div>
            </div>
        `;
    }

    /** 当前需渲染的图集索引（受分区搜索词过滤） */
    function galleryVisibleIndexes() {
        const q = galleryFilterQuery.trim().toLowerCase();
        const all = config.gallery.albums || [];
        if (!q) return all.map((_, i) => i);
        return all.map((a, i) => ({ a, i }))
            .filter(({ a }) => {
                const src = [a.title, a.author, a.sourceUrl, a.date, (a.images || []).length + '张'].join(' ').toLowerCase();
                return src.includes(q);
            })
            .map(x => x.i);
    }

    /** 重绘图集列表（数字分页） */
    function renderGalleryList() {
        const box = $('#gallery-albums-list');
        if (!box) return;
        const albums = config.gallery.albums || [];
        const idxs = galleryVisibleIndexes();
        const totalPages = Math.max(1, Math.ceil(idxs.length / ALBUM_PAGE));
        if (galleryPageCount > totalPages) galleryPageCount = totalPages;
        if (galleryPageCount < 1) galleryPageCount = 1;
        const start = (galleryPageCount - 1) * ALBUM_PAGE;
        const pageIdx = idxs.slice(start, start + ALBUM_PAGE);
        const html = pageIdx.map(i => albumItemHtml(albums[i], i)).join('');
        const pager = idxs.length > ALBUM_PAGE ? paginationHtml(galleryPageCount, totalPages) : '';
        box.innerHTML = (html || '<p class="form-help">' + (galleryFilterQuery ? '没有匹配的写真集。' : '还没有写真集，点击右上角「新增写真集」开始。') + '</p>') + pager;
        bindPager(box, pg => { galleryPageCount = pg; renderGalleryList(); box.scrollIntoView({ block: 'nearest' }); });
        // 更新分区搜索计数
        const countEl = document.querySelector('[data-filter-for="gallery"]')?.parentElement.querySelector('.section-filter__count');
        if (countEl) countEl.textContent = albums.length ? (idxs.length + ' / ' + albums.length + ' 条') : '';
    }

    /** 数字分页条 HTML（Previous / 1 2 3 … / Next，首尾与当前页附近保留，其余折叠为 …） */
    function paginationHtml(current, total) {
        if (total <= 1) return '';
        const pages = [];
        const push = v => { if (!pages.includes(v)) pages.push(v); };
        push(1);
        for (let i = current - 1; i <= current + 1; i++) if (i > 1 && i < total) push(i);
        push(total);
        const items = [];
        for (let k = 0; k < pages.length; k++) {
            if (k > 0 && pages[k] - pages[k - 1] > 1) items.push('<span class="pager__gap">…</span>');
            const pg = pages[k];
            items.push(`<button type="button" class="pager__num${pg === current ? ' is-active' : ''}" data-page="${pg}"${pg === current ? ' aria-current="page"' : ''}>${pg}</button>`);
        }
        return `<nav class="pager" aria-label="分页">
            <button type="button" class="pager__nav" data-page="${current - 1}"${current <= 1 ? ' disabled' : ''}>‹ Previous</button>
            ${items.join('')}
            <button type="button" class="pager__nav" data-page="${current + 1}"${current >= total ? ' disabled' : ''}>Next ›</button>
        </nav>`;
    }

    /** 绑定分页按钮（事件委托，重绘后依然有效） */
    function bindPager(container, go) {
        const nav = container.querySelector('.pager');
        if (!nav) return;
        nav.addEventListener('click', e => {
            const btn = e.target.closest('[data-page]');
            if (!btn || btn.disabled) return;
            const pg = parseInt(btn.dataset.page, 10);
            if (Number.isInteger(pg) && pg >= 1) go(pg);
        });
    }

    function renderGallery() {
        config.gallery = config.gallery || { heading: '写真', albums: [] };
        if (!Array.isArray(config.gallery.albums)) config.gallery.albums = [];
        const galleryEnabledInput = $('#gallery-enabled');
        if (galleryEnabledInput) galleryEnabledInput.checked = findModule('images') ? findModule('images').visible !== false : true;
        $('#gallery-heading').value = config.gallery.heading || '写真';
        galleryPageCount = 1;
        renderGalleryList();
    }

    function renderNews() {
        const data = (config.plugins && config.plugins.data && config.plugins.data['actor-news']) || {};
        const newsEnabledInput = $('#news-enabled');
        if (newsEnabledInput) newsEnabledInput.checked = findModule('news') ? findModule('news').visible !== false : true;
        updateEnableHint('news');
        $('#news-heading').value = data.heading || '';
        $('#news-list').innerHTML = (data.items || []).map((item, i) => {
            const src = [item.title, item.summary, item.date].join(' ').toLowerCase();
            return `
            <div class="content-item admin-content-item is-collapsed" data-index="${i}" data-search="${window.AdminCMS.esc(src)}">
                <div class="content-item__head" data-toggle-item>
                    <span class="content-item__name">${window.AdminCMS.esc(item.title || ('动态 ' + (i + 1)))}</span>
                    <span class="item-meta">${window.AdminCMS.esc(item.date || '')}</span>
                    <span class="item-tools">
                        <button class="btn--danger" data-remove-news="${i}" title="删除动态">×</button>
                        <span class="collapse-chevron">▾</span>
                    </span>
                </div>
                <div class="content-item__body">
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
            </div>
        `;
        }).join('');
    }

    function renderAwards() {
        const data = (config.plugins && config.plugins.data && config.plugins.data['actor-awards']) || {};
        const awardsEnabledInput = $('#awards-enabled');
        if (awardsEnabledInput) awardsEnabledInput.checked = findModule('awards') ? findModule('awards').visible !== false : true;
        updateEnableHint('awards');
        $('#awards-heading').value = data.heading || '';
        $('#awards-list').innerHTML = (data.items || []).map((item, i) => {
            const src = [item.name, item.org, item.work, item.year].join(' ').toLowerCase();
            const meta = [item.year, item.org].filter(Boolean).join(' · ');
            return `
            <div class="content-item admin-content-item is-collapsed" data-index="${i}" data-search="${window.AdminCMS.esc(src)}">
                <div class="content-item__head" data-toggle-item>
                    <span class="content-item__name">${window.AdminCMS.esc(item.name || ('荣誉 ' + (i + 1)))}</span>
                    <span class="item-meta">${window.AdminCMS.esc(meta)}</span>
                    <span class="item-tools">
                        <button class="btn--danger" data-remove-award="${i}" title="删除荣誉">×</button>
                        <span class="collapse-chevron">▾</span>
                    </span>
                </div>
                <div class="content-item__body">
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
            </div>
        `;
        }).join('');
    }

    function renderSchedule() {
        const data = (config.plugins && config.plugins.data && config.plugins.data['actor-schedule']) || {};
        const scheduleEnabledInput = $('#schedule-enabled');
        if (scheduleEnabledInput) scheduleEnabledInput.checked = findModule('schedule') ? findModule('schedule').visible !== false : true;
        updateEnableHint('schedule');
        $('#schedule-heading').value = data.heading || '';
        $('#schedule-list').innerHTML = (data.items || []).map((item, i) => {
            const src = [item.event, item.city, item.date, item.sourceUrl].join(' ').toLowerCase();
            const meta = [item.date, item.city].filter(Boolean).join(' · ');
            return `
            <div class="content-item admin-content-item is-collapsed" data-index="${i}" data-search="${window.AdminCMS.esc(src)}">
                <div class="content-item__head" data-toggle-item>
                    <span class="content-item__name">${window.AdminCMS.esc(item.event || ('行程 ' + (i + 1)))}</span>
                    <span class="item-meta">${window.AdminCMS.esc(meta)}</span>
                    <span class="item-tools">
                        <button class="btn--danger" data-remove-sched="${i}" title="删除行程">×</button>
                        <span class="collapse-chevron">▾</span>
                    </span>
                </div>
                <div class="content-item__body">
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
            </div>
        `;
        }).join('');
        // 行程公告（微博监控等自动同步，无具体日期）
        const annContainer = $('#schedule-announcements');
        if (annContainer) {
            const announcements = data.announcements || [];
            annContainer.innerHTML = announcements.map((a, i) => `
                <div class="content-item admin-content-item is-collapsed" data-announcement-index="${i}" data-search="${window.AdminCMS.esc((a.text || '') + ' ' + (a.month || '') + '月')}">
                    <div class="content-item__head" data-toggle-item>
                        <span class="content-item__name">公告（${window.AdminCMS.esc(a.month || '?')} 月）</span>
                        <span class="item-meta">${window.AdminCMS.esc(String(a.text || '').slice(0, 40))}</span>
                        <span class="item-tools">
                            <button class="btn--danger" data-remove-announcement="${i}" title="删除公告">×</button>
                            <span class="collapse-chevron">▾</span>
                        </span>
                    </div>
                    <div class="content-item__body">
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
                </div>
            `).join('') || '<p class="form-help">暂无公告</p>';
        }
    }

    /** 模块类型 → 管理界面显示名（仅用于展示，不动存储值） */
    const MODULE_TYPE_LABELS = {
        fanGroups: '粉丝群组',
        'hero-split': '竖切 Hero',
        images: '写真/图集'
    };

    function renderModules() {
        const modules = config.modules || [];
        const listTypes = ['works', 'news', 'awards', 'schedule', 'images', 'fanGroups'];
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
                <div class="module-row" data-module-index="${i}" data-module-type="${window.AdminCMS.esc(type)}">
                    <div class="module-row__main">
                        <span class="module-row__type">${window.AdminCMS.esc(MODULE_TYPE_LABELS[type] || type)}</span>
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
        // 重渲染前记住展开状态（启用/停用插件后不收起已展开的卡片）
        const expandedBefore = new Set(Array.from(container.querySelectorAll('.plugin-card:not(.is-collapsed)')).map(c => c.dataset.plugin));

        container.innerHTML = pluginList.map(plugin => {
            const isEnabled = enabled.includes(plugin.name);
            const panel = panels[plugin.name];
            const data = (config.plugins && config.plugins.data && config.plugins.data[plugin.name]) || {};
            // 带面板的插件卡片可折叠：默认收起，点击标题行展开配置
            const foldable = !!(panel && isEnabled && !DEDICATED_PLUGIN_NAMES.includes(plugin.name));
            const folded = foldable && !expandedBefore.has(plugin.name);
            return `
                <div class="plugin-card${folded ? ' is-collapsed' : ''}" data-plugin="${plugin.name}">
                    <div class="plugin-card__header${foldable ? ' is-toggle' : ''}"${foldable ? ' data-toggle-item title="点击展开/收起配置"' : ''}>
                        <h4 class="plugin-card__title">${window.AdminCMS.esc(plugin.manifest.label || plugin.name)} <small>${window.AdminCMS.esc(plugin.manifest.version || '')}</small></h4>
                        ${foldable ? '<span class="collapse-chevron">▾</span>' : ''}
                        <button class="btn btn--sm" data-toggle-plugin="${plugin.name}">${isEnabled ? '停用' : '启用'}</button>
                    </div>
                    ${foldable ? '<div class="plugin-card__body">' : ''}
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
                    ${foldable ? '</div>' : ''}
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
        hero:     { sections: ['hero'], modules: true, collect: function () { collectHero(); if (applyHeroMode()) renderModules(); applyHeroMobileFields(); } },
        works:    { sections: ['works'], modules: true, collect: collectWorks },
        gallery:  { sections: ['gallery'], modules: true, collect: collectGallery },
        news:     { plugin: 'actor-news', modules: true, collect: collectNews },
        awards:   { plugin: 'actor-awards', modules: true, collect: collectAwards },
        schedule: { plugin: 'actor-schedule', modules: true, collect: collectSchedule },
        about:    { sections: ['about'], modules: true, collect: collectAbout },
        social:   { sections: ['social'], collect: collectSocial },
        fanGroups: { sections: ['fanGroups'], modules: true, collect: collectFanGroups },
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

    // 只保存指定分区（自动保存用）。
    // batch=true（saveAllSections 批量循环）：服务端回包只含当前分区，整体替换内存会洗掉
    // 其他分区的本地未保存改动（添加分类后保存即消失的根因）——此时只回填当前分区字段。
    async function saveSection(name, silent = false, batch = false) {
        if (name === 'plugins') return savePluginPanels();
        const def = SECTION_SAVERS[name];
        if (!def) return { ok: false, error: '未知分区: ' + name };
        if (configLoadFailed || !config || typeof config !== 'object') {
            return { ok: false, error: '配置未加载（请刷新页面重试）' };
        }
        if (def.collect) {
            try {
                def.collect();
            } catch (e) {
                console.error('[save] collect failed:', name, e);
                return { ok: false, error: name + ' 分区收集失败: ' + e.message };
            }
        }

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
            if (json && json.config) {
                if (batch) {
                    // 批量保存：仅回填本分区（服务端深合并结果），保留其他分区的本地改动
                    (def.sections || []).forEach(k => { if (json.config[k] !== undefined) config[k] = json.config[k]; });
                    if (def.modules && Array.isArray(json.config.modules)) config.modules = json.config.modules;
                } else {
                    config = json.config; // 单分区保存：内存与服务端对齐，杜绝旧快照覆盖
                }
            }
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
            try {
                const r = await saveSection(name, true, true); // batch：不整体替换内存
                if (!r.ok) failed.push(name + ': ' + (r.error || '失败'));
            } catch (e) {
                console.error('[save] section failed:', name, e);
                failed.push(name + ': ' + e.message);
            }
        }
        // 全部落盘后统一对齐服务端（此时所有分区都已保存，整体替换是安全的）
        if (!failed.length) {
            const fresh = await fetch('/api/config').then(r => r.json()).catch(() => null);
            if (fresh && !fresh.error) config = fresh;
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
        // 保存后同步界面：分类下拉/条目名称等在 config 更新后需重渲染（否则显示旧值像"没保存"）
        if (!failed.length) syncSectionsUI();
    }

    /** 保存成功后重渲染易失同步的分区界面（带焦点保护，不打断正在编辑的输入） */
    function syncSectionsUI() {
        const focused = document.activeElement;
        const focusId = focused && focused.id ? focused.id : null;
        const focusCat = focused && focused.dataset ? focused.dataset.catName : null;
        renderWorks();
        renderGallery();
        reapplySectionFilters();   // 列表被重建 → 重新应用过滤，避免搜索状态被"冲掉"
        if (focusCat) {
            const again = document.querySelector(`[data-cat-name="${focusCat}"]`);
            if (again && again.focus) again.focus();
        } else if (focusId) {
            const again = document.getElementById(focusId);
            if (again && again.focus) again.focus();
        }
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

        // 制作组成员（悬停「©杉果派」弹出）
        const members = [];
        document.querySelectorAll('#footer-credits-list .credit-member-item').forEach(item => {
            const i = item.dataset.index;
            const name = item.querySelector(`[data-credit-name="${i}"]`).value.trim();
            const role = item.querySelector(`[data-credit-role="${i}"]`).value.trim();
            const link = item.querySelector(`[data-credit-link="${i}"]`).value.trim();
            if (!name && !role && !link) return;
            members.push({ name, role, link });
        });
        const creditsTitleInput = $('#footer-credits-title');
        config.footer.credits = {
            title: (creditsTitleInput ? creditsTitleInput.value.trim() : '') || '制作组',
            members
        };
    }

    function collectGallery() {
        config.gallery = config.gallery || { heading: '写真', albums: [] };
        config.gallery.heading = $('#gallery-heading').value;
        const galleryEnabledInput = $('#gallery-enabled');
        if (galleryEnabledInput) setModuleVisible('images', galleryEnabledInput.checked);

        // ⚠️ 分页渲染：只渲染了前 N 页，不能「遍历 DOM 重建数组」——否则未渲染的会被丢弃。
        // 以现有 config.gallery.albums 为底（长度即真相），已渲染的条目用 DOM 值覆盖。
        const base = config.gallery.albums || [];
        const albums = base.slice();
        document.querySelectorAll('#gallery-albums-list .album-item').forEach(item => {
            const ai = parseInt(item.dataset.albumIndex, 10);
            if (!Number.isInteger(ai) || ai < 0 || ai >= albums.length) return;   // 防御：新增/删除错位时跳过越界项
            const images = item.querySelector(`[data-album-images="${ai}"]`).value.split('\n').map(s => s.trim()).filter(Boolean);
            albums[ai] = {
                id: (base[ai] || {}).id,
                title: item.querySelector(`[data-album-title="${ai}"]`).value,
                date: item.querySelector(`[data-album-date="${ai}"]`).value,
                cover: item.querySelector(`[data-album-cover="${ai}"]`).value || images[0] || '',
                author: item.querySelector(`[data-album-author="${ai}"]`).value,
                sourceUrl: item.querySelector(`[data-album-source="${ai}"]`).value,
                images
            };
        });
        config.gallery.albums = albums;
    }

    /* ---------- 粉丝群组（独立页面 /groups.html） ---------- */
    function renderFanGroups() {
        const fg = config.fanGroups || { heading: '粉丝群组', desc: '', groups: [] };
        const visInput = $('#fanGroups-visible');
        if (visInput) visInput.checked = findModule('fanGroups') ? findModule('fanGroups').visible !== false : true;
        const h = $('#fanGroups-heading'); if (h) h.value = fg.heading || '';
        const d = $('#fanGroups-desc'); if (d) d.value = fg.desc || '';
        const box = $('#fan-groups-list');
        if (!box) return;
        const groups = Array.isArray(fg.groups) ? fg.groups : [];
        box.innerHTML = groups.map((g, i) => `
            <div class="list-item fan-group-item" data-index="${i}">
                <input type="text" data-fan-name="${i}" value="${window.AdminCMS.esc((g && g.name) || '')}" placeholder="名称（如：官方后援会）">
                <input type="text" data-fan-platform="${i}" value="${window.AdminCMS.esc((g && g.platform) || '')}" placeholder="平台（QQ/微信/微博）">
                <input type="text" data-fan-country="${i}" value="${window.AdminCMS.esc((g && g.country) || '')}" placeholder="国家（如：中国）">
                <input type="text" data-fan-region="${i}" value="${window.AdminCMS.esc((g && g.region) || '')}" placeholder="地区（如：上海）">
                <input type="text" data-fan-admin="${i}" value="${window.AdminCMS.esc((g && g.admin) || '')}" placeholder="管理员（可选，如：张三）">
                <input type="text" data-fan-admin-url="${i}" value="${window.AdminCMS.esc((g && g.adminUrl) || '')}" placeholder="管理员主页链接（可选，https://...）">
                <input type="text" data-fan-url="${i}" value="${window.AdminCMS.esc((g && g.url) || '')}" placeholder="https://... 邀请链接（可留空）">
                <input type="text" data-fan-note="${i}" value="${window.AdminCMS.esc((g && g.note) || '')}" placeholder="备注（可选）">
                <button class="btn--danger" data-remove-fan-group="${i}" title="删除群组">×</button>
            </div>
        `).join('') || '<p class="form-help">还没有群组，点右上角「+ 添加群组」。</p>';
    }

    function collectFanGroups() {
        config.fanGroups = config.fanGroups || { heading: '粉丝群组', desc: '', groups: [] };
        const h = $('#fanGroups-heading'); config.fanGroups.heading = h ? h.value.trim() : '粉丝群组';
        const d = $('#fanGroups-desc'); config.fanGroups.desc = d ? d.value.trim() : '';
        const visInput = $('#fanGroups-visible');
        if (visInput) setModuleVisible('fanGroups', visInput.checked);
        const groups = [];
        document.querySelectorAll('#fan-groups-list .fan-group-item').forEach(item => {
            const i = item.dataset.index;
            const val = sel => { const el = item.querySelector(sel); return el ? el.value.trim() : ''; };
            const name = val(`[data-fan-name="${i}"]`);
            const platform = val(`[data-fan-platform="${i}"]`);
            const country = val(`[data-fan-country="${i}"]`);
            const region = val(`[data-fan-region="${i}"]`);
            const admin = val(`[data-fan-admin="${i}"]`);
            const adminUrl = val(`[data-fan-admin-url="${i}"]`);
            const url = val(`[data-fan-url="${i}"]`);
            const note = val(`[data-fan-note="${i}"]`);
            if (!name && !url) return;      // 全空则丢弃
            groups.push({ name, platform, country, region, admin, adminUrl, url, note });
        });
        config.fanGroups.groups = groups;
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
                id: (data.items[i] || {}).id,
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
                id: (data.items[i] || {}).id,
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
                id: (data.items[i] || {}).id,
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
                id: ((data.announcements || [])[i] || {}).id,
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
            // ⚠️ 必须从 data-module-type 取原始 type：界面上显示的是中文标签，
            // 用 textContent 反读会把中文当 type 写回 config（曾把 images 写成「写真/图集」导致模块失效）
            const type = (row.dataset.moduleType || '').trim()
                || row.querySelector('.module-row__type').textContent.trim();
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
        config.modules = config.modules || []; // 配置异常/未加载时不再 TypeError（其余函数早有 || [] 口径）
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

    const MEDIA_PAGE = 20;       // 媒体库每页条数
    let mediaItems = [];         // 最近一次拉取的全部媒体（本地 + R2 远程）
    let mediaPageCount = 1;      // 当前页（1-based）

    async function renderMedia() {
        try {
            const res = await fetch('/api/images');
            const data = await res.json();
            mediaItems = Array.isArray(data) ? data : [];
            renderMediaList();
        } catch (e) {
            console.error('media load error', e);
        }
    }

    /** 按当前页渲染媒体网格 + 分页条（分页条在网格外，避免被当作网格项） */
    function renderMediaList() {
        const list = $('#media-list');
        if (!list) return;
        const total = mediaItems.length;
        const totalPages = Math.max(1, Math.ceil(total / MEDIA_PAGE));
        if (mediaPageCount > totalPages) mediaPageCount = totalPages;
        if (mediaPageCount < 1) mediaPageCount = 1;
        const start = (mediaPageCount - 1) * MEDIA_PAGE;
        const pageItems = mediaItems.slice(start, start + MEDIA_PAGE);

        list.innerHTML = pageItems.map(img => `
                <div class="media-item${img.remote ? ' media-item--remote' : ''}">
                    <img src="${img.url}" alt="媒体" loading="lazy">
                    <button class="media-item__copy" data-copy="${window.AdminCMS.esc(img.url)}" title="复制链接">⧉</button>
                    <button class="media-item__delete" data-delete="${img.remote ? 'remote/' + encodeURIComponent(img.id) : encodeURIComponent(img.filename)}" ${img.remote ? `data-remote-url="${window.AdminCMS.esc(img.url)}"` : ''} title="${img.remote ? '从 R2 存储桶删除（不可恢复）' : '删除'}">×</button>
                    <span class="media-item__url"><span class="media-item__tag">${img.remote ? 'R2' : '本地'}</span>${img.url}</span>
                </div>
            `).join('') || '<p>暂无图片，点击右上角上传。</p>';

        const pagerBox = $('#media-pager');
        if (!pagerBox) return;
        pagerBox.innerHTML = total > MEDIA_PAGE
            ? `<p class="media-count">共 ${total} 张 · 第 ${mediaPageCount} / ${totalPages} 页</p>${paginationHtml(mediaPageCount, totalPages)}`
            : '';
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

        // 分页条：委托在常驻容器上绑定一次（renderMediaList 会重写其 innerHTML，
        // 若每次渲染都绑一次会累积监听器）
        const pagerBox = $('#media-pager');
        if (pagerBox) {
            pagerBox.addEventListener('click', e => {
                const btn = e.target.closest('[data-page]');
                if (!btn || btn.disabled) return;
                const pg = parseInt(btn.dataset.page, 10);
                if (!Number.isInteger(pg) || pg < 1) return;
                mediaPageCount = pg;
                renderMediaList();
                pagerBox.scrollIntoView({ block: 'nearest' });
            });
        }

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
                // R2 远程照片：真删存储桶对象（不可恢复），成功后媒体库登记一并清理
                const remoteUrl = btn.dataset.remoteUrl;
                if (remoteUrl) {
                    if (!window.confirm('确定从 R2 存储桶删除该照片吗？此操作不可恢复，图片外链将失效。')) return;
                    try {
                        const res = await fetch('/api/plugins/cloudflare-r2/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: remoteUrl })
                        });
                        const data = await res.json();
                        if (data && data.success) {
                            showToast('✅ 已从 R2 存储桶删除');
                        } else {
                            const errMsg = data && data.results && data.results[0] && data.results[0].error;
                            showToast(errMsg || '删除失败', true);
                        }
                    } catch (err) {
                        console.error('delete error', err);
                        showToast('删除失败：' + err.message, true);
                    }
                    await renderMedia();
                    return;
                }
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
            fanGroups: ['fanGroups'],
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
                // 评论管理：每次进入都拉最新数据（服务器为唯一事实源）
                if (link.dataset.section === 'comments') renderCommentsAdmin();
            });
        });

        const toggle = $('#mobileToggle');
        const sidebar = $('#sidebar');
        if (toggle && sidebar) {
            // 移动端抽屉遮罩：点空白关闭侧栏（随需创建，避免改 HTML 结构）
            let backdrop = document.getElementById('sidebarBackdrop');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'sidebarBackdrop';
                backdrop.className = 'sidebar-backdrop';
                document.body.appendChild(backdrop);
            }
            const setSidebar = open => {
                sidebar.classList.toggle('sidebar--open', open);
                toggle.classList.toggle('mobile-toggle--active', open);
                backdrop.classList.toggle('is-open', open);
            };
            toggle.addEventListener('click', () => setSidebar(!sidebar.classList.contains('sidebar--open')));
            backdrop.addEventListener('click', () => setSidebar(false));
            // Esc 关闭
            document.addEventListener('keydown', e => { if (e.key === 'Escape') setSidebar(false); });
            // 切分区后自动收起（窄屏点完菜单应让出内容区）
            document.querySelectorAll('.sidebar__link').forEach(link => {
                link.addEventListener('click', () => { if (window.innerWidth <= 900) setSidebar(false); });
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
        // 不立即保存：等失焦/点空白时统一提交（避免打字过程中频繁写盘）
    }

    /** 失焦触发：光标离开输入框且落到非输入区域时提交（点空白、Tab 切走、点按钮等） */
    function onFocusOut(e) {
        const next = e.relatedTarget;
        // 焦点仍在输入类元素内（如从标题切到作者）不触发，等真正离开再存
        if (next && next.closest && next.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (!dirtySections.size) return;
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(saveDirtySections, 150); // 极短延迟：让同一次点击内的多次失焦合并为一次保存
    }

    /** 兜底：切页/关闭标签前把未保存内容提交（beforeunload 用同步语义，尽量落盘） */
    function flushDirtySync() {
        if (!dirtySections.size) return;
        // 无法在卸载时等异步：用 sendBeacon 或同步 XHR 兜底（这里走同步 XHR 保证尽力落盘）
        for (const n of Array.from(dirtySections)) {
            const def = SECTION_SAVERS[n];
            if (!def || !def.sections) continue;
            try {
                if (def.collect) def.collect();
                const sections = {};
                def.sections.forEach(k => { if (config[k] !== undefined) sections[k] = config[k]; });
                const body = { sections };
                if (def.modules && Array.isArray(config.modules)) body.modules = config.modules;
                const xhr = new XMLHttpRequest();
                xhr.open('PATCH', '/api/config', false); // 同步：保证卸载前发出
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify(body));
            } catch (err) { /* 尽力而为 */ }
        }
        dirtySections.clear();
    }

    // 只自动保存发生过编辑的分区（全局生效，与预览面板无关）
    async function saveDirtySections() {
        if (!dirtySections.size) return;
        const names = Array.from(dirtySections);
        dirtySections.clear();
        const failed = [];
        for (const n of names) {
            const r = await saveSection(n, true, true); // batch：不整体替换内存，避免洗掉其他分区本地改动
            if (!r.ok) { dirtySections.add(n); failed.push(n); } // 失败保留脏标记，下轮重试
        }
        if (!failed.length) {
            syncSectionsUI(); // 保存成功后同步界面（分类下拉等）
            showToast('已自动保存');
        } else {
            showToast('自动保存失败：' + failed.join('、') + '（将继续重试）', true);
        }
        if (previewEnabled) refreshPreview();
    }

    function bindAutoSave() {
        // 委托监听：模块列表等动态重渲染内容也生效
        document.addEventListener('input', onAutoSaveInput, true);
        document.addEventListener('change', onAutoSaveInput, true);
        // 失焦（点空白/Tab 切走/点其他控件）时提交
        document.addEventListener('focusout', onFocusOut, true);
        // 点页面空白处（未聚焦任何输入）也提交一次
        document.addEventListener('click', e => {
            if (!dirtySections.size) return;
            const inField = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], button, a, label');
            if (!inField) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(saveDirtySections, 150); }
        }, true);
        // 离开页面前兜底提交
        window.addEventListener('beforeunload', flushDirtySync);
    }

    function onAutoSaveInput(e) {
        const el = e.target;
        if (el.type === 'file') return;
        // 纯 UI 控件不算数据：分区搜索框、全局搜索、以及任何标记了 data-no-dirty 的输入。
        // 否则「在搜索框打字」会 markDirty → 失焦自动保存 → 重绘列表，把搜索结果冲掉。
        if (el.matches('[data-filter-for], #globalSearch, [data-no-dirty]')) return;
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

    // 新增条目后自动展开（默认折叠）
    function expandNewest(selector) {
        const rows = document.querySelectorAll(selector);
        const last = rows[rows.length - 1];
        if (last) last.classList.remove('is-collapsed');
    }

    /* ===================================================================
       列表浏览优化：折叠卡片 + 分区过滤 + 全局搜索
       =================================================================== */
    /** 应用分区过滤（幂等，可在列表重绘后重复调用）
     *  返回 { total, shown }；写真集因分页渲染走独立分支，不在此处理。
     *  抽成函数的原因：自动保存成功后会重绘列表，若不重新应用过滤，
     *  用户搜完再编辑字段 → 列表被重建 → 过滤"失效"（搜索框有词但结果全回来了）。 */
    function applySectionFilter(section, q) {
        const countEl = document.querySelector('[data-filter-for="' + section + '"]')?.parentElement.querySelector('.section-filter__count');
        const rows = [];
        if (section === 'works') rows.push(...document.querySelectorAll('#work-category-panel .admin-work-item'));
        else if (section === 'news') rows.push(...document.querySelectorAll('#news-list .admin-content-item'));
        else if (section === 'awards') rows.push(...document.querySelectorAll('#awards-list .admin-content-item'));
        else if (section === 'schedule') {
            rows.push(...document.querySelectorAll('#schedule-list .admin-content-item'),
                ...document.querySelectorAll('#schedule-announcements .admin-content-item'));
        } else return null;
        const key = String(q || '').trim().toLowerCase();
        let total = 0, shown = 0;
        rows.forEach(r => {
            total++;
            const hit = !key || String(r.dataset.search || '').includes(key);
            r.style.display = hit ? '' : 'none';
            if (hit) shown++;
        });
        if (countEl) countEl.textContent = total ? (shown + ' / ' + total + ' 条') : '';
        return { total, shown };
    }

    /** 重绘后重新应用所有分区过滤（列表重建会丢失 display:none 状态与计数） */
    function reapplySectionFilters() {
        document.querySelectorAll('[data-filter-for]').forEach(input => {
            const section = input.dataset.filterFor;
            if (section === 'gallery') return;             // 分页渲染：query 存在模块变量里，renderGalleryList 自身会处理
            if (input.value.trim()) applySectionFilter(section, input.value);
            else applySectionFilter(section, '');          // 空词也刷新计数
        });
    }

    function bindListControls() {
        // 1) 点击条目头部展开/收起（忽略按钮，避免误触删除）
        document.addEventListener('click', e => {
            const head = e.target.closest('[data-toggle-item]');
            if (!head || e.target.closest('button')) return;
            const item = head.closest('.admin-content-item, .admin-work-item, .admin-album-item, .plugin-card');
            if (item) item.classList.toggle('is-collapsed');
        });

        // 2) 分区内实时过滤
        document.querySelectorAll('[data-filter-for]').forEach(input => {
            input.addEventListener('input', () => {
                const q = input.value.trim().toLowerCase();
                const section = input.dataset.filterFor;
                const countEl = input.parentElement.querySelector('.section-filter__count');
                // 写真集是分页渲染的：过滤需重绘列表（未渲染条目无法靠 display 控制）
                if (section === 'gallery') {
                    galleryFilterQuery = input.value.trim();
                    galleryPageCount = 1;
                    renderGalleryList();
                    return;
                }
                applySectionFilter(section, q);
            });
        });

        // 3) 全局搜索：跨分区检索，点击跳转定位
        const gs = $('#globalSearch');
        const gr = $('#globalSearchResults');
        if (!gs || !gr) return;
        const clean = s => String(s || '').toLowerCase();
        const esc = window.AdminCMS.esc;

        const buildGroups = () => {
            const q = clean(gs.value.trim());
            const groups = [];
            const add = (label, section, entries) => {
                const hits = entries.filter(e => clean(e.disp).includes(q)).slice(0, 12);
                if (hits.length) groups.push({ label, section, hits });
            };
            // 作品（跨分类，key = ci-ii）
            const works = [];
            (config.works.categories || []).forEach((cat, ci) => (cat.items || []).forEach((it, ii) => {
                works.push({ key: ci + '-' + ii, disp: it.title || ('未命名 ' + ci + '-' + ii) });
            }));
            add('作品', 'works', works);
            add('写真集', 'gallery', (config.gallery.albums || []).map((a, i) => ({ key: String(i), disp: [a.title, a.date, a.author].filter(Boolean).join(' ') + (a.author ? `（${a.author}）` : '') })));
            add('动态', 'news', ((config.plugins && config.plugins.data['actor-news'] || {}).items || []).map((it, i) => ({ key: String(i), disp: (it.title || '') + ' ' + (it.date || '') })));
            add('荣誉', 'awards', ((config.plugins && config.plugins.data['actor-awards'] || {}).items || []).map((it, i) => ({ key: String(i), disp: (it.name || '') + ' ' + (it.year || '') })));
            add('行程', 'schedule', ((config.plugins && config.plugins.data['actor-schedule'] || {}).items || []).map((it, i) => ({ key: String(i), disp: (it.event || '') + ' · ' + (it.date || '') + (it.city ? ' · ' + it.city : '') })));
            add('行程公告', 'schedule-ann', ((config.plugins && config.plugins.data['actor-schedule'] || {}).announcements || []).map((it, i) => ({ key: String(i), disp: (it.month ? it.month + '月' : '') + ' ' + (it.text || '').slice(0, 40) })));
            add('社交链接', 'social', (config.social && config.social.links || []).map((it, i) => ({ key: String(i), disp: it.name || it.url || '' })));
            add('版权链接', 'footer', ((config.footer && config.footer.links) || []).map((it, i) => ({ key: String(i), disp: it.text + ' ' + (it.url || '') })));
            add('制作组', 'footer-credits', ((config.footer && config.footer.credits && config.footer.credits.members) || []).map((it, i) => ({ key: String(i), disp: (it.name || '') + ' ' + (it.role || '') })));
            const mods = [];
            (config.modules || []).forEach((m, i) => { if (m.type) mods.push({ key: String(i), disp: '模块 ' + m.type }); });
            add('模块', 'modules', mods);
            // 评论（昵称 + 内容 + 所属页面名都可命中，key = pageKey|commentId）
            const commentEntries = [];
            Object.entries(config.comments || {}).forEach(([pk, list]) => {
                if (!Array.isArray(list)) return;
                const label = commentPageLabel(pk);
                list.forEach(c => {
                    if (!c || !c.id) return;
                    commentEntries.push({ key: pk + '|' + c.id, disp: label + ' · ' + (c.n || '马铃薯') + '：' + (c.t || '') });
                });
            });
            add('评论', 'comments', commentEntries);
            return groups;
        };

        gs.addEventListener('input', () => {
            const q = gs.value.trim();
            if (!q) { gr.style.display = 'none'; gr.innerHTML = ''; return; }
            const groups = buildGroups();
            gr.innerHTML = groups.map(g => `
                <div class="global-search__group">
                    <div class="global-search__label">${esc(g.label)}（${g.hits.length}）</div>
                    ${g.hits.slice(0, 6).map(h => `<button type="button" class="global-search__item" data-goto="${g.section}" data-key="${esc(h.key)}">${esc(h.disp)}</button>`).join('')}
                    ${g.hits.length > 6 ? `<div class="global-search__more">…共 ${g.hits.length} 条</div>` : ''}
                </div>`).join('') || '<div class="global-search__empty">无匹配内容</div>';
            gr.style.display = 'block';
        });

        gr.addEventListener('click', async e => {
            const btn = e.target.closest('[data-goto]');
            if (!btn) return;
            const section = btn.dataset.goto;
            const key = btn.dataset.key;
            const q = gs.value.trim();
            // 切换到目标分区
            const nav = document.querySelector('.sidebar__link[data-section="' + section + '"]');
            if (nav) nav.click();
            else if (section === 'schedule-ann') {
                const s = document.querySelector('.sidebar__link[data-section="schedule"]');
                if (s) s.click();
            }
            else if (section === 'footer-credits') {
                const s = document.querySelector('.sidebar__link[data-section="footer"]');
                if (s) s.click();
            }
            // 评论管理为异步渲染：等列表就绪后再定位（渲染有序号守卫，与侧边栏触发的渲染并发安全）
            if (section === 'comments') await renderCommentsAdmin();
            // 应用分区过滤
            const f = document.querySelector('[data-filter-for="' + section + '"]');
            if (f) { f.value = q; f.dispatchEvent(new Event('input')); }
            // 定位并展开目标条目
            const row = section === 'comments' ? document.querySelector('[data-comment-key="' + key + '"]')
                : section === 'works' ? document.querySelector('[data-work-key="' + key + '"]')
                : section === 'gallery' ? document.querySelector('[data-album-index="' + key + '"]')
                : section === 'schedule-ann' ? document.querySelector('[data-announcement-index="' + key + '"]')
                : section === 'social' ? document.querySelector('#social-list [data-index="' + key + '"]')
                : section === 'footer' ? document.querySelector('#footer-links-list [data-index="' + key + '"]')
                : section === 'footer-credits' ? document.querySelector('#footer-credits-list [data-index="' + key + '"]')
                : section === 'modules' ? document.querySelector('#modules-list [data-module-index="' + key + '"]')
                : section === 'news' ? document.querySelector('#news-list [data-index="' + key + '"]')
                : section === 'awards' ? document.querySelector('#awards-list [data-index="' + key + '"]')
                : document.querySelector('#schedule-list [data-index="' + key + '"]');
            if (row) {
                if (section === 'comments') expandCommentPage(row.closest('.comment-admin__page'));
                row.classList.remove('is-collapsed');
                row.style.display = '';
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.style.outline = '2px solid var(--color-accent)';
                setTimeout(() => { row.style.outline = ''; }, 2500);
            }
            gr.style.display = 'none';
            gs.blur();
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('.global-search')) gr.style.display = 'none';
        });
    }

    /* ===================================================================
       评论管理（独立于模块管理；端点即时生效，不走全局保存——避免同状态双入口覆盖）
       =================================================================== */

    let commentsAdminState = { enabled: true };
    let commentRenderSeq = 0;

    /* 折叠状态（localStorage 记忆，跨重渲染/会话保持） */
    const COLLAPSED_KEY = 'comment-admin-collapsed';
    function getCollapsedPages() {
        try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')); } catch (e) { return new Set(); }
    }
    function saveCollapsedPages(set) {
        try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])); } catch (e) { /* 隐私模式 */ }
    }
    function toggleCommentPage(pageEl) {
        if (!pageEl) return;
        const key = pageEl.dataset.commentPage;
        const set = getCollapsedPages();
        if (pageEl.classList.toggle('is-collapsed')) set.add(key); else set.delete(key);
        saveCollapsedPages(set);
    }
    function expandCommentPage(pageEl) {
        if (pageEl && pageEl.classList.contains('is-collapsed')) toggleCommentPage(pageEl);
    }

    /* 展示键 → 友好名称（与后端 /api/comments/admin 同口径，供全局搜索使用） */
    function commentPageLabel(pageKey) {
        if (pageKey === 'news') return '最新动态';
        let m = pageKey.match(/^album-([A-Za-z0-9_-]{1,32})$/);
        if (m) {
            const a = ((config.gallery && config.gallery.albums) || []).find(x => x.id === m[1]);
            return a && a.title ? '写真集「' + a.title + '」' : '写真集 ' + m[1];
        }
        m = pageKey.match(/^work-([A-Za-z0-9_-]{1,32})$/);
        if (m) {
            for (const cat of (config.works && config.works.categories) || []) {
                const hit = (cat.items || []).find(x => x.id === m[1]);
                if (hit) return '作品「' + (hit.title || m[1]) + '」';
            }
            return '作品 ' + m[1];
        }
        return pageKey;
    }

    async function renderCommentsAdmin() {
        const seq = ++commentRenderSeq; // 并发渲染守卫：慢响应不得覆盖新结果
        const listEl = $('#comments-admin-list');
        const btn = $('#btn-toggle-comments');
        const status = $('#comments-switch-status');
        try {
            const data = await (await fetch('/api/comments/admin')).json();
            if (seq !== commentRenderSeq) return;
            commentsAdminState.enabled = !!(data.settings && data.settings.enabled);
            if (btn) btn.textContent = commentsAdminState.enabled ? '一键关闭评论' : '一键开启评论';
            if (status) status.textContent = commentsAdminState.enabled ? '当前：已启用' : '当前：已关闭（数据保留）';
            if (!listEl) return;
            const esc = window.AdminCMS.esc;
            const pages = data.pages || [];
            if (!pages.length) {
                listEl.innerHTML = '<p class="form-help">暂无评论。</p>';
                return;
            }
            const total = pages.reduce((n, p) => n + (p.count || 0), 0);
            const collapsed = getCollapsedPages();
            listEl.innerHTML = pages.map(p => `
                <div class="comment-admin__page${collapsed.has(p.key) ? ' is-collapsed' : ''}" data-comment-page="${esc(p.key)}">
                    <div class="comment-admin__page-head" data-page-toggle="${esc(p.key)}" title="点击折叠 / 展开">
                        <span class="comment-admin__chevron">▾</span>
                        <strong>${esc(p.label)}</strong>
                        <span class="comment-admin__key">${esc(p.key)} · ${p.count} 条</span>
                    </div>
                    ${p.comments.map(c => `
                        <div class="comment-admin__row" data-comment-key="${esc(p.key)}|${esc(c.id)}">
                            <div class="comment-admin__row-main">
                                <span class="comment-admin__meta">${esc(c.n || '马铃薯')} · ${esc(c.d)}${c.replyTo ? ' · 回复 ' + esc(c.replyTo) : ''}</span>
                                <p class="comment-admin__text">${esc(c.t)}</p>
                            </div>
                            <button type="button" class="btn btn--ghost btn--sm" data-comment-del="${esc(p.key)}|${esc(c.id)}">删除</button>
                        </div>
                    `).join('')}
                </div>
            `).join('') + `<p class="form-help" style="margin-top:0.75rem">共 ${pages.length} 个页面 / ${total} 条评论。点击分组标题可折叠；删除后前台随下次导出生效。</p>`;
        } catch (e) {
            if (seq !== commentRenderSeq) return;
            if (listEl) listEl.innerHTML = `<p class="form-help">加载失败：${window.AdminCMS.esc(e.message)}</p>`;
        }
    }

    function bindCommentsAdmin() {
        const btn = $('#btn-toggle-comments');
        if (btn) {
            btn.addEventListener('click', async () => {
                const target = !commentsAdminState.enabled;
                const tip = target
                    ? '确认启用评论功能？'
                    : '确认关闭评论功能？关闭后全站评论区不再渲染、提交端点拒绝新留言（已有数据保留）。';
                if (!confirm(tip)) return;
                btn.disabled = true;
                try {
                    const res = await fetch('/api/comments/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: target })
                    });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error || 'http ' + res.status);
                } catch (e) {
                    alert('操作失败：' + e.message);
                }
                btn.disabled = false;
                renderCommentsAdmin();
            });
        }

        const list = $('#comments-admin-list');
        if (list) {
            list.addEventListener('click', async e => {
                // 分组标题：折叠 / 展开
                const head = e.target.closest('[data-page-toggle]');
                if (head) {
                    toggleCommentPage(head.closest('.comment-admin__page'));
                    return;
                }
                const del = e.target.closest('[data-comment-del]');
                if (!del) return;
                const [page, id] = del.dataset.commentDel.split('|');
                if (!confirm('确认删除这条评论？其下回复将上移为一级评论。')) return;
                del.disabled = true;
                try {
                    const res = await fetch(`/api/comments/admin/${encodeURIComponent(page)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error || 'http ' + res.status);
                } catch (e2) {
                    alert('删除失败：' + e2.message);
                    del.disabled = false;
                }
                renderCommentsAdmin();
            });
        }
    }

    function bindGlobal() {
        bindSectionNav();
        bindMedia();
        bindTheme();
        bindAutoSave();
        bindListControls();
        bindCommentsAdmin();

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
            expandNewest('#work-category-panel .admin-work-item');
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
                expandNewest('#work-category-panel .admin-work-item');
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
        // 粉丝群组：增删
        const addFan = $('#btn-add-fan-group');
        if (addFan) addFan.addEventListener('click', () => {
            // 重绘会重建列表 → 先 collect 把当前 DOM 值回写 config，否则未保存的编辑会被冲掉
            collectFanGroups();
            config.fanGroups.groups.push({ name: '', platform: '', country: '', region: '', admin: '', adminUrl: '', url: '', note: '' });
            renderFanGroups();
        });
        const fanList = $('#fan-groups-list');
        if (fanList) fanList.addEventListener('click', e => {
            const btn = e.target.closest('[data-remove-fan-group]');
            if (!btn) return;
            collectFanGroups();                       // 先落当前编辑
            const i = parseInt(btn.dataset.removeFanGroup, 10);
            (config.fanGroups.groups || []).splice(i, 1);
            renderFanGroups();
            showToast('已删除群组（保存后生效）');
        });

        $('#btn-add-social').addEventListener('click', () => {
            collectSocial();                          // 重绘前先落当前编辑（否则被冲掉）
            config.social = config.social || { links: [] };
            config.social.links.push({ name: '', url: '' });
            renderSocial();
        });
        $('#social-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove-social]');
            if (!btn) return;
            collectSocial();                          // 先落当前编辑，再删（否则重绘冲掉其他行）
            const idx = parseInt(btn.dataset.removeSocial);
            config.social.links.splice(idx, 1);
            renderSocial();
        });

        // 页脚版权链接：新增插到固定条（末位）之前；固定条不可删除
        $('#btn-add-footer-link').addEventListener('click', () => {
            collectFooter();                          // 重绘前先落当前编辑
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
                collectFooter();                      // 先落当前编辑，再删
                const links = Array.isArray(config.footer.links) ? config.footer.links : [];
                const idx = parseInt(btn.dataset.removeFooterLink);
                const target = links[idx];
                if (!target) return;
                if (target.text === FIXED_FOOTER_LINK.text && target.url === FIXED_FOOTER_LINK.url) return; // 固定条不可删
                links.splice(idx, 1);
                renderFooter();
            });
        }

        // 制作组成员：新增/删除
        $('#btn-add-credit-member').addEventListener('click', () => {
            collectFooter();                          // 重绘前先落当前编辑
            config.footer = config.footer || {};
            if (!config.footer.credits || typeof config.footer.credits !== 'object') config.footer.credits = { members: [] };
            if (!Array.isArray(config.footer.credits.members)) config.footer.credits.members = [];
            config.footer.credits.members.push({ name: '', role: '', link: '' });
            renderFooter();
        });
        const footerCreditsList = $('#footer-credits-list');
        if (footerCreditsList) {
            footerCreditsList.addEventListener('click', e => {
                const btn = e.target.closest('[data-remove-credit]');
                if (!btn) return;
                collectFooter();                      // 先落当前编辑，再删
                const idx = parseInt(btn.dataset.removeCredit);
                const members = (config.footer.credits && config.footer.credits.members) || [];
                if (members[idx]) members.splice(idx, 1);
                renderFooter();
            });
        }

        // 写真集
        $('#btn-add-album').addEventListener('click', () => {
            config.gallery = config.gallery || { heading: '写真', albums: [] };
            if (!Array.isArray(config.gallery.albums)) config.gallery.albums = [];
            config.gallery.albums.push({ title: '新写真集', cover: '', images: [] });
            // 新增项在数组末尾：清空搜索、翻到最后一页，否则分页下看不到它
            galleryFilterQuery = '';
            const qInput = document.querySelector('[data-filter-for="gallery"]');
            if (qInput) qInput.value = '';
            galleryPageCount = Math.ceil(config.gallery.albums.length / ALBUM_PAGE) || 1;
            renderGalleryList();
            expandNewest('#gallery-albums-list .admin-album-item');
        });
        $('#gallery-albums-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove-album]');
            if (!btn) return;
            const ai = parseInt(btn.dataset.removeAlbum);
            config.gallery.albums.splice(ai, 1);
            // 删除后部分索引变化：重置搜索并回到第 1 页，避免索引错位造成误解
            galleryFilterQuery = '';
            const qInput = document.querySelector('[data-filter-for="gallery"]');
            if (qInput) qInput.value = '';
            galleryPageCount = 1;
            renderGalleryList();
            showToast('已删除写真集（保存后生效）');
        });

        // 启用开关切换：立即写入配置 + 同步另一处勾选 + 更新状态提示（未保存也可见）
        ['news', 'awards', 'schedule'].forEach(type => {
            const input = $(`#${type}-enabled`);
            if (input) input.addEventListener('change', () => {
                setModuleVisible(type, input.checked);
                updateEnableHint(type);
            });
        });
        // 模块管理卡片的显示勾选同样立即生效
        $('#modules-list').addEventListener('change', e => {
            if (!e.target.matches('[data-module-visible]')) return;
            const idx = parseInt(e.target.dataset.moduleVisible);
            const mod = (config.modules || [])[idx];
            if (!mod) return;
            setModuleVisible(mod.type, e.target.checked);
            if (['news', 'awards', 'schedule'].includes(mod.type)) updateEnableHint(mod.type);
        });

        // 动态
        $('#btn-add-news').addEventListener('click', () => {
            if (!config.plugins) config.plugins = { enabled: [], data: {} };
            if (!config.plugins.data) config.plugins.data = {};
            const data = config.plugins.data['actor-news'] = config.plugins.data['actor-news'] || { heading: '', items: [] };
            data.items.push({ date: '', title: '', summary: '' });
            renderNews();
            expandNewest('#news-list .admin-content-item');
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
            expandNewest('#awards-list .admin-content-item');
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
            expandNewest('#schedule-list .admin-content-item');
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
                // 用服务器确认的数据刷新内存并原地重渲染该面板：
                // 否则之后任何 renderPlugins 都会用页面加载时的旧数据回显（如轮询间隔改完又变回旧值），
                // 面板缓存的 currentData 也会一直是旧快照，下次保存把旧状态合并回服务器
                if (json && json.data && config.plugins && config.plugins.data) config.plugins.data[name] = json.data;
                const panelEl = document.querySelector(`[data-plugin-panel="${name}"]`);
                if (panelEl && typeof panel.render === 'function') {
                    panelEl.innerHTML = panel.render(json.data || {});
                    if (typeof panel.bind === 'function') panel.bind();
                }
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
