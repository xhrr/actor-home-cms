/**
 * Actor Home CMS — 内置核心模块
 * 所有内置模块通过 CMS.registerModule 注册，插件也可以注册同类型模块覆盖。
 */
(function () {
    'use strict';

    const C = SITE_CONFIG;
    const U = window.CMS.utils;
    const esc = U.esc;
    const safeUrl = U.safeUrl;
    const normalizeChoice = U.normalizeChoice;
    const sanitizeHtml = U.sanitizeHtml;

window.CMS.registerModule('hero', function (mod) {
        const actor = C.actor || {};
        const hero = C.hero || {};
        const img = safeUrl(hero.image || actor.cover, 'image');
        const name = esc(actor.name || 'Actor');
        const nameEn = esc(actor.nameEn || '');
        const tagline = esc(actor.tagline || actor.title || '');
        const scroll = esc(hero.scrollHint || 'SCROLL');
        return `
<section class="hero" id="hero" data-module="hero">
    <div class="hero__media">
        <img src="${img}" alt="${name}" onerror="this.parentElement.classList.add('is-empty')">
    </div>
    <div class="hero__content">
        <p class="hero__eyebrow">${nameEn}</p>
        <h1 class="hero__title">${name}</h1>
        <p class="hero__subtitle">${tagline}</p>
        <span class="hero__scroll">${scroll}</span>
    </div>
</section>`;
    }, { nav: { href: '#hero', text: '首页' } });

    window.CMS.registerModule('hero-split', function (mod) {
        const actor = C.actor || {};
        const hero = C.hero || {};
        const images = (mod.images && mod.images.length) ? mod.images : [hero.image, hero.image, hero.image, hero.image];
        const name = esc(actor.name || 'Actor');
        const nameEn = esc(actor.nameEn || '');
        const tagline = esc(actor.tagline || actor.title || '');
        return `
<section class="hero-split" id="hero-split" data-module="hero-split" data-hero-split>
    <div class="hero-split__columns">
        ${images.map((img, i) => `
            <div class="split-col${i === 0 ? ' is-active' : ''}" data-split-index="${i}">
                <img src="${safeUrl(img, 'image')}" alt="${name}" decoding="async" onerror="this.parentElement.classList.add('is-empty')">
                <span class="split-col__veil" aria-hidden="true"></span>
            </div>
        `).join('')}
    </div>
    <div class="hero-split__content">
        <p class="hero-split__eyebrow">${nameEn}</p>
        <h1 class="hero-split__title">${name}</h1>
        <p class="hero-split__subtitle">${tagline}</p>
        <span class="hero-split__scroll">${esc(hero.scrollHint || 'SCROLL')}</span>
    </div>
</section>`;
    }, { nav: { href: '#hero-split', text: '首页' } });

    window.CMS.registerModule('about', function (mod) {
        if (!mod || mod.visible === false) return '';
        const actor = C.actor || {};
        const about = C.about || {};
        const visible = mod.visible !== false && about.visible !== false;
        if (!visible) return '';
        const bio = (about.bio && about.bio.length ? about.bio : actor.bio || []);
        const stats = (about.stats && about.stats.length ? about.stats : actor.stats || []);
        const img = safeUrl(about.image || actor.avatar, 'image');
        const name = esc(actor.name || '');
        return `
<section class="section about" id="about" data-module="about">
    <div class="section__head">
        <p class="section__label">ABOUT</p>
        <h2 class="section__title">关于演员</h2>
    </div>
    <div class="about__grid">
        <div class="about__image">
            <img src="${img}" alt="${name}" onerror="this.parentElement.classList.add('is-empty')">
        </div>
        <div class="about__body">
            <h3 class="about__name">${name}</h3>
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
</section>`;
    }, { nav: { href: '#about', text: '关于' } });

    window.CMS.registerModule('works', function (mod) {
        if (!mod || mod.visible === false) return '';
        const works = C.works || {};
        const categories = Array.isArray(works.categories) && works.categories.length
            ? works.categories
            : (works.items || []).length ? [{ name: '代表作品', items: works.items }] : [];
        const limit = mod.limit || 3;
        const heading = works.heading || '代表作品';

        // 把所有分类的作品拍平，按上映时间降序（新的在前），首页直接展示前 N 条
        const flat = [];
        categories.forEach((cat, ci) => {
            (cat.items || []).forEach((item, ii) => {
                flat.push({ cat, ci, ii, item });
            });
        });
        flat.sort((a, b) => U.parseTime(b.item.year || b.item.releaseDate) - U.parseTime(a.item.year || a.item.releaseDate));
        const shown = flat.slice(0, limit);
        const hasAny = flat.length > 0;
        return `
<section class="section works" id="works" data-module="works">
    <div class="section__head">
        <p class="section__label">SELECTED WORKS</p>
        <h2 class="section__title">${esc(heading)}</h2>
    </div>
    <div class="works__list">
        ${shown.map(({ cat, ci, ii, item }, idx) => {
            const poster = safeUrl(item.poster || item.image, 'image');
            const num = String(idx + 1).padStart(2, '0'); // 编号按排序后顺序
            return `
            <article class="work-item" data-index="${ci}-${ii}">
                <div class="work-item__num">${num}</div>
                <a class="work-item__media" href="/gallery.html?cat=${ci}&work=${ii}">
                    <img src="${poster}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')">
                </a>
                <div class="work-item__info">
                    <h3 class="work-item__title">${esc(item.title)}</h3>
                    <p class="work-item__meta">${esc(cat.name || item.type || '')} · ${esc(U.formatTime(item.year || item.releaseDate))} · ${esc(item.director || '')}</p>
                    <p class="work-item__role">饰演 ${esc(item.role || '')}</p>
                    <p class="work-item__synopsis">${esc(item.synopsis || '')}</p>
                </div>
            </article>`;
        }).join('')}
    </div>
    ${hasAny ? `<div class="section__more"><a class="hover-underline" href="/works.html">查看全部作品</a></div>` : ''}
</section>`;
    }, { nav: { href: '#works', text: '作品' } });

    window.CMS.registerModule('images', function (mod) {
        if (!mod || mod.visible === false) return '';
        const label = mod.label || '写真';
        const layout = normalizeChoice(mod.layout, ['grid', 'wide', 'single'], 'grid');
        const limit = mod.limit || 3;
        const gallery = C.gallery || { albums: [] };
        const albums = Array.isArray(gallery.albums) ? gallery.albums : [];
        const isPrimaryImages = C.modules.findIndex(m => m.type === 'images') === C.modules.indexOf(mod);

        // 主写真模块：展示写真集封面
        if (isPrimaryImages && albums.length) {
            const shown = albums.slice(0, limit);
            return `
<section class="section gallery" id="gallery" data-module="images">
    <div class="section__head">
        <p class="section__label">GALLERY</p>
        <h2 class="section__title">${esc(gallery.heading || label)}</h2>
    </div>
    <div class="gallery__albums">
        ${shown.map((album, ai) => {
            const cover = safeUrl(album.cover || (album.images && album.images[0]), 'image');
            return `
                <a class="album-card" href="/gallery.html?album=${ai}">
                    <div class="album-card__cover">
                        <img src="${cover}" alt="${esc(album.title || '写真集')}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')">
                    </div>
                    <h3 class="album-card__title">${esc(album.title || ('写真集 ' + (ai + 1)))}</h3>
                    ${album.author ? `<span class="album-card__author">作者：${esc(album.author)}</span>` : ''}
                    <span class="album-card__count">${(album.images || []).length} 张</span>
                </a>
            `;
        }).join('')}
    </div>
    ${albums.length ? `<div class="section__more"><a class="hover-underline" href="/gallery.html">查看全部写真</a></div>` : ''}
</section>`;
        }

        // 普通/自定义图片模块：保持原来的图片网格
        const allList = mod.images || [];
        if (!allList.length) return '';
        const list = allList.slice(0, limit);
        return `
<section class="section gallery" id="gallery" data-module="images">
    <div class="section__head">
        <p class="section__label">GALLERY</p>
        <h2 class="section__title">${esc(label)}</h2>
    </div>
    <div class="gallery__grid gallery__grid--${esc(layout)}">
        ${list.map(url => `
            <figure class="gallery__item">
                <img src="${safeUrl(url, 'image')}" alt="${esc(label)}" loading="lazy" onerror="this.style.display='none'">
            </figure>
        `).join('')}
    </div>
    ${allList.length ? `<div class="section__more"><a class="hover-underline" href="/gallery.html">查看全部写真</a></div>` : ''}
</section>`;
    }, { nav: { href: '#gallery', text: '写真' } });

    window.CMS.registerModule('text', function (mod, idx) {
        if (!mod || mod.visible === false) return '';
        if (mod.content === undefined && mod.text === undefined) return '';
        const content = sanitizeHtml(mod.content || mod.text || '');
        const label = mod.label || '';
        return `
<section class="section section--text" id="module-text-${idx}" data-module="text">
    <div class="section__head">
        ${label ? `<p class="section__label">${esc(label)}</p>` : ''}
    </div>
    <div class="text-module__content">${content}</div>
</section>`;
    });

    window.CMS.registerModule('news', function (mod) {
        if (!mod || mod.visible === false) return '';
        const pluginData = (C.plugins && C.plugins.data && C.plugins.data['actor-news']) || {};
        const allItems = pluginData.items || [];
        const limit = mod.limit || 3;
        const items = allItems.slice(0, limit);
        const heading = pluginData.heading || '最新动态';
        if (!allItems.length) return '';
        return `
<section class="section section--plugin news" id="news" data-module="news">
    <div class="section__head">
        <p class="section__label">NEWS</p>
        <h2 class="section__title">${esc(heading)}</h2>
    </div>
    <div class="plugin-list">
        ${items.map(item => `
            <article class="plugin-list__item news-item">
                <span class="plugin-list__label">${esc(item.date || '')}</span>
                <div>
                    <h3 class="plugin-list__title">${esc(item.title || '')}</h3>
                    <p class="plugin-list__desc">${esc(item.summary || '')}</p>
                </div>
            </article>
        `).join('')}
    </div>
    ${allItems.length ? `<div class="section__more"><a class="hover-underline" href="/news.html">查看全部动态</a></div>` : ''}
</section>`;
    }, { nav: { href: '#news', text: '动态' } });

    window.CMS.registerModule('awards', function (mod) {
        if (!mod || mod.visible === false) return '';
        const pluginData = (C.plugins && C.plugins.data && C.plugins.data['actor-awards']) || {};
        const allItems = pluginData.items || [];
        const limit = mod.limit || 4;
        const items = allItems.slice(0, limit);
        if (!allItems.length) return '';
        return `
<section class="section section--plugin awards" id="awards" data-module="awards">
    <div class="section__head">
        <p class="section__label">AWARDS</p>
        <h2 class="section__title">${esc(pluginData.heading || '荣誉奖项')}</h2>
    </div>
    <div class="plugin-list">
        ${items.map(item => `
            <article class="plugin-list__item award-item">
                <span class="plugin-list__label">${esc(item.year || '')}</span>
                <div>
                    <h3 class="plugin-list__title">${esc(item.name || '')}</h3>
                    <p class="plugin-list__desc">${esc(item.org || '')} · ${esc(item.work || '')}</p>
                </div>
            </article>
        `).join('')}
    </div>
    ${allItems.length ? `<div class="section__more"><a class="hover-underline" href="/awards.html">查看全部荣誉</a></div>` : ''}
</section>`;
    }, { nav: { href: '#awards', text: '荣誉' } });

    window.CMS.registerModule('schedule', function (mod) {
        if (!mod || mod.visible === false) return '';
        const pluginData = (C.plugins && C.plugins.data && C.plugins.data['actor-schedule']) || {};
        const allItems = pluginData.items || [];
        const limit = mod.limit || 3;
        const items = allItems.slice(0, limit);
        if (!allItems.length) return '';
        return `
<section class="section section--plugin schedule" id="schedule" data-module="schedule">
    <div class="section__head">
        <p class="section__label">SCHEDULE</p>
        <h2 class="section__title">${esc(pluginData.heading || '近期行程')}</h2>
    </div>
    <div class="plugin-list">
        ${items.map(item => `
            <article class="plugin-list__item schedule-item">
                <span class="plugin-list__label">${esc(item.date || '')} · ${esc(item.city || '')}</span>
                <div>
                    <h3 class="plugin-list__title">${esc(item.event || '')}</h3>
                </div>
            </article>
        `).join('')}
    </div>
    ${allItems.length ? `<div class="section__more"><a class="hover-underline" href="/schedule.html">查看全部行程</a></div>` : ''}
</section>`;
    }, { nav: { href: '#schedule', text: '行程' } });

    window.CMS.registerModule('footer', function () {
        const social = C.social || { links: [] };
        const footer = C.footer || {};
        const links = social.links || [];
        const copyright = footer.copyright || '';
        return `
<footer class="footer" id="footer" data-module="footer">
    <div class="footer__inner">
        <p class="footer__brand">${esc((C.actor && C.actor.nameEn) || '')}</p>
        <div class="footer__social">
            ${links.map(l => `<a href="${safeUrl(l.url, 'link') || '#'}" target="_blank" rel="noopener noreferrer">${esc(l.name)}</a>`).join('')}
        </div>
        <p class="footer__copy">${esc(copyright)}</p>
    </div>
</footer>`;
    }, { nav: { href: '#footer', text: '联系' } });

})();
