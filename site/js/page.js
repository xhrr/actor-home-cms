/**
 * 独立内容页通用渲染器
 * 通过 window.PAGE_TYPE 决定渲染 works / news / awards / schedule
 */
(function () {
    'use strict';

    const C = SITE_CONFIG;
    const U = window.CMS.utils;
    const esc = U.esc;
    const safeUrl = U.safeUrl;
    const sanitizeHtml = U.sanitizeHtml;
    const type = window.PAGE_TYPE || '';
    // 运行时国际化（i18n.js 同步加载在前），缺失时回退中文默认值
    const T = (window.I18N && window.I18N.t) || ((key, fallback) => (fallback == null ? key : fallback));
    const pick = (window.I18N && window.I18N.pick) || ((obj, field) => (obj && obj[field] != null ? obj[field] : ''));

    const app = document.getElementById('app');
    if (!app) return;

    function head(label, title) {
        return `
            <div class="section__head">
                <p class="section__label">${esc(label)}</p>
                <h2 class="section__title">${esc(title)}</h2>
            </div>
        `;
    }

    let worksFilterQuery = '';
    let worksActiveCat = null;

    function renderWorks() {
        const works = C.works || {};
        const categories = Array.isArray(works.categories) && works.categories.length
            ? works.categories
            : (works.items || []).length ? [{ name: T('works.title', '代表作品'), items: works.items }] : [];
        app.innerHTML = head('WORKS', pick(works, 'heading') || T('works.title', '代表作品')) + `
            <div class="works-filter" id="works-filter">
                <button type="button" class="works-filter__link active" data-filter="">${esc(T('common.all', '全部'))}</button>
                ${categories.map((cat, ci) => `<button type="button" class="works-filter__link" data-filter="${ci}">${esc(cat.name || '')}</button>`).join('')}
            </div>
            <div class="page-search">
                <input type="search" id="works-search-input" placeholder="${esc(T('works.searchPlaceholder', '搜索作品标题 / 角色 / 导演 / 类型…'))}" autocomplete="off">
                <span class="page-search__count" id="works-search-count"></span>
            </div>
            <div id="works-category-results"></div>
        `;

        const filter = document.getElementById('works-filter');
        if (filter) {
            filter.addEventListener('click', e => {
                const btn = e.target.closest('.works-filter__link');
                if (!btn) return;
                Array.prototype.forEach.call(filter.querySelectorAll('.works-filter__link'), b => b.classList.remove('active'));
                btn.classList.add('active');
                worksActiveCat = btn.dataset.filter === '' ? null : parseInt(btn.dataset.filter, 10);
                renderWorksResults(worksActiveCat);
            });
        }
        const input = document.getElementById('works-search-input');
        if (input) {
            input.addEventListener('input', () => {
                worksFilterQuery = input.value.trim();
                renderWorksResults(worksActiveCat);
            });
        }
        renderWorksResults(worksActiveCat);
    }

    function renderWorksResults(selectedCat) {
        const works = C.works || {};
        const categories = Array.isArray(works.categories) && works.categories.length
            ? works.categories
            : (works.items || []).length ? [{ name: T('works.title', '代表作品'), items: works.items }] : [];
        const container = document.getElementById('works-category-results');
        if (!container) return;

        const q = worksFilterQuery.trim().toLowerCase();
        const match = (item, catName) => !q || [item.title, item.role, item.director, item.type, item.year, item.releaseDate, item.synopsis, catName]
            .some(f => String(f || '').toLowerCase().includes(q));

        const list = selectedCat === null ? categories : categories.filter((_, i) => i === selectedCat);
        let totalShown = 0;
        container.innerHTML = list.map((cat, ci) => {
            // 先按搜索词过滤（保留原始索引，保证图集链接正确），再按上映时间降序排序
            const items = (cat.items || []).map((item, ii) => ({ item, ii }))
                .filter(x => match(x.item, cat.name))
                .sort((a, b) => U.parseTime(b.item.year || b.item.releaseDate) - U.parseTime(a.item.year || a.item.releaseDate));
            if (!items.length) return '';
            totalShown += items.length;
            const realCi = selectedCat === null ? ci : selectedCat;

            const renderItem = ({ item, ii }, idx) => {
                const poster = safeUrl(item.poster || item.image, 'image');
                const source = safeUrl(item.sourceUrl, 'link');
                return `
                            <article class="work-item">
                                <div class="work-item__num">${String(idx + 1).padStart(2, '0')}</div>
                                <div class="work-item__media">
                                    <img src="${poster}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')" onload="this.closest('.work-item__media').classList.toggle('is-portrait', this.naturalHeight > this.naturalWidth)">
                                </div>
                                <div class="work-item__info">
                                    <h3 class="work-item__title"><a class="work-item__link" href="/gallery.html${item.id ? `?work=${item.id}` : `?cat=${realCi}&work=${ii}`}">${esc(item.title)}</a></h3>
                                    <p class="work-item__meta">${esc(cat.name || item.type || '')} · ${esc(U.formatTime(item.year || item.releaseDate))} · ${esc(item.director || '')}</p>
                                    <p class="work-item__role">${esc(T('works.rolePrefix', '饰演 '))}${esc(item.role || '')}</p>
                                    <p class="work-item__synopsis">${esc(item.synopsis || '')}</p>
                                    ${source ? `<p class="work-item__source"><a class="hover-underline" href="${source}" target="_blank" rel="noopener">${esc(T('common.originalLink', '原始链接 ↗'))}</a></p>` : ''}
                                </div>
                            </article>
                        `;
            };

            return `
                <div class="works-category">
                    <h3 class="works-category__title">${esc(cat.name || T('works.title', '代表作品'))}</h3>
                    <div class="works__list works__list--feature">
                        ${items.map(renderItem).join('')}
                    </div>
                </div>
            `;
        }).join('') || `<p class="works-empty">${esc(T('works.emptySearch', '未找到匹配的作品'))}</p>`;

        const countEl = document.getElementById('works-search-count');
        if (countEl) {
            const total = categories.reduce((n, c) => n + (c.items || []).length, 0);
            countEl.textContent = q ? (totalShown + ' / ' + total + T('unit.item', ' 条')) : '';
        }

        // 动态插入的内容直接显示，避免被滚动动画默认隐藏
        Array.prototype.forEach.call(container.querySelectorAll('.work-item, .works-category__title, .section__head'), el => {
            el.classList.add('is-visible');
        });
    }

    function renderNews() {
        const data = (C.plugins && C.plugins.data && C.plugins.data['actor-news']) || {};
        const items = (data.items || []).slice().sort((a, b) => U.parseTime(b.date) - U.parseTime(a.date)); // 按时间降序（最新在前）
        app.innerHTML = head('NEWS', pick(data, 'heading') || T('news.title', '最新动态')) + `
            <div class="plugin-list">
                ${items.map(item => `
                    <article class="plugin-list__item news-item">
                        <span class="plugin-list__label">${esc(item.date || '')}</span>
                        <div>
                            <h3 class="plugin-list__title">${esc(item.title || '')}</h3>
                            <p class="plugin-list__desc">${esc(item.summary || '')}</p>
                            ${safeUrl(item.sourceUrl, 'link') ? `<p class="plugin-list__source"><a class="hover-underline" href="${safeUrl(item.sourceUrl, 'link')}" target="_blank" rel="noopener">${esc(T('common.originalLink', '原始链接 ↗'))}</a></p>` : ''}
                        </div>
                    </article>
                `).join('') || `<p class="plugin-list__desc">${esc(T('news.empty', '暂无动态'))}</p>`}
            </div>
        `;
    }

    function renderAwards() {
        const data = (C.plugins && C.plugins.data && C.plugins.data['actor-awards']) || {};
        const items = data.items || [];
        app.innerHTML = head('AWARDS', pick(data, 'heading') || T('awards.title', '荣誉奖项')) + `
            <div class="plugin-list">
                ${items.map(item => `
                    <article class="plugin-list__item award-item">
                        <span class="plugin-list__label">${esc(item.year || '')}</span>
                        <div>
                            <h3 class="plugin-list__title">${esc(item.name || '')}</h3>
                            <p class="plugin-list__desc">${esc(item.org || '')} · ${esc(item.work || '')}</p>
                        </div>
                    </article>
                `).join('') || `<p class="plugin-list__desc">${esc(T('awards.empty', '暂无奖项'))}</p>`}
            </div>
        `;
    }

    function renderSchedule() {
        const data = (C.plugins && C.plugins.data && C.plugins.data['actor-schedule']) || {};
        const items = (data.items || []).slice().sort((a, b) => U.parseTime(b.date) - U.parseTime(a.date)); // 按日期降序（最新在前）
        const announcements = data.announcements || [];
        app.innerHTML = head('SCHEDULE', pick(data, 'heading') || T('schedule.title', '近期行程')) + `
            ${announcements.length ? `
                <div class="schedule-announcement">
                    ${announcements.map(a => `
                        <p class="schedule-announcement__text">${esc(a.text || '')}</p>
                        ${safeUrl(a.sourceUrl, 'link') ? `<p class="schedule-announcement__source"><a class="hover-underline" href="${safeUrl(a.sourceUrl, 'link')}" target="_blank" rel="noopener">${esc(T('common.originalLink', '原始链接 ↗'))}</a></p>` : ''}
                    `).join('')}
                </div>
            ` : ''}
            <div class="plugin-list">
                ${items.map(item => `
                    <article class="plugin-list__item schedule-item">
                        <span class="plugin-list__label">
                            <em class="schedule-date">${esc(item.date || '')}</em>
                            <em class="schedule-city">${esc(item.city || '')}</em>
                        </span>
                        <div>
                            <h3 class="plugin-list__title">${esc(item.event || '')}</h3>
                            ${safeUrl(item.sourceUrl, 'link') ? `<p class="plugin-list__source"><a class="hover-underline" href="${safeUrl(item.sourceUrl, 'link')}" target="_blank" rel="noopener">${esc(T('common.originalLink', '原始链接 ↗'))}</a></p>` : ''}
                        </div>
                    </article>
                `).join('') || `<p class="plugin-list__desc">${esc(T('schedule.empty', '暂无行程'))}</p>`}
            </div>
        `;
    }

    function renderAbout() {
        const actor = C.actor || {};
        const about = C.about || {};
        const bio = ((pick(about, 'bio') || []).length ? pick(about, 'bio') : (pick(actor, 'bio') || []));
        const stats = (about.stats && about.stats.length ? about.stats : actor.stats || []);
        const img = safeUrl(about.image || actor.avatar, 'image');
        app.innerHTML = head('ABOUT', pick(about, 'heading') || T('about.title', '关于演员')) + `
            <div class="about__grid">
                <div class="about__image">
                    <img src="${img}" alt="${esc(actor.name || '')}" onerror="this.parentElement.classList.add('is-empty')">
                </div>
                <div class="about__body">
                    <h3 class="about__name">${esc(actor.name || '')}</h3>
                    <p class="about__role">${esc(pick(actor, 'title') || '')}</p>
                    <div class="about__bio">${bio.map(p => '<p>' + esc(p) + '</p>').join('')}</div>
                    <div class="about__stats">
                        ${stats.map(s => `
                            <div class="about__stat">
                                <span class="about__stat-value">${esc(s.value || '')}</span>
                                <span class="about__stat-label">${esc(pick(s, 'label') || '')}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    /* 粉丝群组：群/小组邀请链接 + 国家/地区两级点击筛选
       筛选用「单一 data 属性」判定（data-fan-country / data-fan-region），
       不要把两个语义写在同一个按钮上——那会导致批量切 active 时互相污染。 */
    function renderGroups() {
        const fg = C.fanGroups || {};
        const all = window.CMS.fanGroupList(fg);
        const desc = String(pick(fg, 'desc') || '').trim();
        let curCountry = '';
        let curRegion = '';

        app.innerHTML = head('COMMUNITY', pick(fg, 'heading') || T('groups.title', '粉丝群组')) + `
            ${desc ? `<div class="fan-groups__desc">${sanitizeHtml(desc)}</div>` : ''}
            <div class="fan-filter" id="fanFilter"></div>
            <p class="fan-groups__count" id="fanGroupsCount"></p>
            <div class="fan-groups__list" id="fanGroupsList"></div>
        `;
        const filterBox = document.getElementById('fanFilter');
        const listBox = document.getElementById('fanGroupsList');
        const countEl = document.getElementById('fanGroupsCount');

        /** 地区候选池：选了国家则只列该国的地区，否则为全部 */
        function regionPool() {
            const pool = curCountry
                ? all.filter(g => String(g.country || '').trim() === curCountry)
                : all;
            return window.CMS.fanGroupFilterData(pool).regions;
        }

        function renderFilter() {
            const { countries } = window.CMS.fanGroupFilterData(all);
            const regions = regionPool();
            if (curRegion && !regions.includes(curRegion)) curRegion = '';   // 切换国家后旧地区失效
            filterBox.innerHTML = [
                countries.length ? `
                <div class="fan-filter__row">
                    <span class="fan-filter__label">${esc(T('groups.filterCountry', '国家'))}</span>
                    <button type="button" class="fan-filter__link${curCountry === '' ? ' active' : ''}" data-fan-country="">${esc(T('common.all', '全部'))}</button>
                    ${countries.map(c => `<button type="button" class="fan-filter__link${curCountry === c ? ' active' : ''}" data-fan-country="${esc(c)}">${esc(c)}</button>`).join('')}
                </div>` : '',
                regions.length ? `
                <div class="fan-filter__row fan-filter__row--region">
                    <span class="fan-filter__label">${esc(T('groups.filterRegion', '地区'))}</span>
                    <button type="button" class="fan-filter__link${curRegion === '' ? ' active' : ''}" data-fan-region="">${esc(T('common.all', '全部'))}</button>
                    ${regions.map(r => `<button type="button" class="fan-filter__link${curRegion === r ? ' active' : ''}" data-fan-region="${esc(r)}">${esc(r)}</button>`).join('')}
                </div>` : ''
            ].filter(Boolean).join('');
        }

        function renderList() {
            let list = all;
            if (curCountry) list = list.filter(g => String(g.country || '').trim() === curCountry);
            if (curRegion) list = list.filter(g => String(g.region || '').trim() === curRegion);
            listBox.innerHTML = list.map(g => window.CMS.fanGroupCardHtml(g)).join('')
                || `<p class="plugin-list__desc">${esc(T('groups.emptyFilter', '该筛选下暂无群组'))}</p>`;
            if (countEl) {
                const filtering = curCountry || curRegion;
                countEl.textContent = filtering ? T('groups.countTpl', `筛选出 ${list.length} / ${all.length} 个群组`, { shown: list.length, total: all.length }) : '';
            }
        }

        filterBox.addEventListener('click', e => {
            const btn = e.target.closest('[data-fan-country], [data-fan-region]');
            if (!btn) return;
            if (btn.dataset.fanCountry !== undefined) {
                curCountry = btn.dataset.fanCountry;
                curRegion = '';                 // 换国家 → 重置地区
                renderFilter();
            } else {
                curRegion = btn.dataset.fanRegion;
                renderFilter();
            }
            renderList();
        });

        renderFilter();
        renderList();
    }

    switch (type) {
        case 'about': renderAbout(); break;
        case 'works': renderWorks(); break;
        case 'news': renderNews(); break;
        case 'awards': renderAwards(); break;
        case 'schedule': renderSchedule(); break;
        case 'groups': renderGroups(); break;
        default:
            app.innerHTML = `<p>${esc(T('page.unknown', '未知页面类型'))}</p>`;
    }

    window.CMS.initNavShell();
    window.CMS.revealNow(app);
})();