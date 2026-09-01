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
    const type = window.PAGE_TYPE || '';

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
            : (works.items || []).length ? [{ name: '代表作品', items: works.items }] : [];
        app.innerHTML = head('WORKS', works.heading || '代表作品') + `
            <div class="works-filter" id="works-filter">
                <button type="button" class="works-filter__link active" data-filter="">全部</button>
                ${categories.map((cat, ci) => `<button type="button" class="works-filter__link" data-filter="${ci}">${esc(cat.name || '')}</button>`).join('')}
            </div>
            <div class="page-search">
                <input type="search" id="works-search-input" placeholder="搜索作品标题 / 角色 / 导演 / 类型…" autocomplete="off">
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
            : (works.items || []).length ? [{ name: '代表作品', items: works.items }] : [];
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
                                <a class="work-item__media" href="/gallery.html?cat=${realCi}&work=${ii}">
                                    <img src="${poster}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')" onload="this.closest('.work-item__media').classList.toggle('is-portrait', this.naturalHeight > this.naturalWidth)">
                                </a>
                                <div class="work-item__info">
                                    <h3 class="work-item__title">${esc(item.title)}</h3>
                                    <p class="work-item__meta">${esc(cat.name || item.type || '')} · ${esc(U.formatTime(item.year || item.releaseDate))} · ${esc(item.director || '')}</p>
                                    <p class="work-item__role">饰演 ${esc(item.role || '')}</p>
                                    <p class="work-item__synopsis">${esc(item.synopsis || '')}</p>
                                    ${source ? `<p class="work-item__source"><a class="hover-underline" href="${source}" target="_blank" rel="noopener">原始链接 ↗</a></p>` : ''}
                                </div>
                            </article>
                        `;
            };

            return `
                <div class="works-category">
                    <h3 class="works-category__title">${esc(cat.name || '代表作品')}</h3>
                    <div class="works__list works__list--feature">
                        ${items.map(renderItem).join('')}
                    </div>
                </div>
            `;
        }).join('') || '<p class="works-empty">未找到匹配的作品</p>';

        const countEl = document.getElementById('works-search-count');
        if (countEl) {
            const total = categories.reduce((n, c) => n + (c.items || []).length, 0);
            countEl.textContent = q ? (totalShown + ' / ' + total + ' 条') : '';
        }

        // 动态插入的内容直接显示，避免被滚动动画默认隐藏
        Array.prototype.forEach.call(container.querySelectorAll('.work-item, .works-category__title, .section__head'), el => {
            el.classList.add('is-visible');
        });
    }

    function renderNews() {
        const data = (C.plugins && C.plugins.data && C.plugins.data['actor-news']) || {};
        const items = (data.items || []).slice().sort((a, b) => U.parseTime(b.date) - U.parseTime(a.date)); // 按时间降序（最新在前）
        app.innerHTML = head('NEWS', data.heading || '最新动态') + `
            <div class="plugin-list">
                ${items.map(item => `
                    <article class="plugin-list__item news-item">
                        <span class="plugin-list__label">${esc(item.date || '')}</span>
                        <div>
                            <h3 class="plugin-list__title">${esc(item.title || '')}</h3>
                            <p class="plugin-list__desc">${esc(item.summary || '')}</p>
                            ${safeUrl(item.sourceUrl, 'link') ? `<p class="plugin-list__source"><a class="hover-underline" href="${safeUrl(item.sourceUrl, 'link')}" target="_blank" rel="noopener">原始链接 ↗</a></p>` : ''}
                        </div>
                    </article>
                `).join('') || '<p class="plugin-list__desc">暂无动态</p>'}
            </div>
        `;
    }

    function renderAwards() {
        const data = (C.plugins && C.plugins.data && C.plugins.data['actor-awards']) || {};
        const items = data.items || [];
        app.innerHTML = head('AWARDS', data.heading || '荣誉奖项') + `
            <div class="plugin-list">
                ${items.map(item => `
                    <article class="plugin-list__item award-item">
                        <span class="plugin-list__label">${esc(item.year || '')}</span>
                        <div>
                            <h3 class="plugin-list__title">${esc(item.name || '')}</h3>
                            <p class="plugin-list__desc">${esc(item.org || '')} · ${esc(item.work || '')}</p>
                        </div>
                    </article>
                `).join('') || '<p class="plugin-list__desc">暂无奖项</p>'}
            </div>
        `;
    }

    function renderSchedule() {
        const data = (C.plugins && C.plugins.data && C.plugins.data['actor-schedule']) || {};
        const items = (data.items || []).slice().sort((a, b) => U.parseTime(b.date) - U.parseTime(a.date)); // 按日期降序（最新在前）
        const announcements = data.announcements || [];
        app.innerHTML = head('SCHEDULE', data.heading || '近期行程') + `
            ${announcements.length ? `
                <div class="schedule-announcement">
                    ${announcements.map(a => `
                        <p class="schedule-announcement__text">${esc(a.text || '')}</p>
                        ${safeUrl(a.sourceUrl, 'link') ? `<p class="schedule-announcement__source"><a class="hover-underline" href="${safeUrl(a.sourceUrl, 'link')}" target="_blank" rel="noopener">原始链接 ↗</a></p>` : ''}
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
                            ${safeUrl(item.sourceUrl, 'link') ? `<p class="plugin-list__source"><a class="hover-underline" href="${safeUrl(item.sourceUrl, 'link')}" target="_blank" rel="noopener">原始链接 ↗</a></p>` : ''}
                        </div>
                    </article>
                `).join('') || '<p class="plugin-list__desc">暂无行程</p>'}
            </div>
        `;
    }

    function renderAbout() {
        const actor = C.actor || {};
        const about = C.about || {};
        const bio = (about.bio && about.bio.length ? about.bio : actor.bio || []);
        const stats = (about.stats && about.stats.length ? about.stats : actor.stats || []);
        const img = safeUrl(about.image || actor.avatar, 'image');
        app.innerHTML = head('ABOUT', about.heading || '关于演员') + `
            <div class="about__grid">
                <div class="about__image">
                    <img src="${img}" alt="${esc(actor.name || '')}" onerror="this.parentElement.classList.add('is-empty')">
                </div>
                <div class="about__body">
                    <h3 class="about__name">${esc(actor.name || '')}</h3>
                    <p class="about__role">${esc(actor.title || '')}</p>
                    <div class="about__bio">${bio.map(p => '<p>' + esc(p) + '</p>').join('')}</div>
                    <div class="about__stats">
                        ${stats.map(s => `
                            <div class="about__stat">
                                <span class="about__stat-value">${esc(s.value || '')}</span>
                                <span class="about__stat-label">${esc(s.label || '')}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    switch (type) {
        case 'about': renderAbout(); break;
        case 'works': renderWorks(); break;
        case 'news': renderNews(); break;
        case 'awards': renderAwards(); break;
        case 'schedule': renderSchedule(); break;
        default:
            app.innerHTML = '<p>未知页面类型</p>';
    }

    window.CMS.initNavShell();
    window.CMS.revealNow(app);
})();