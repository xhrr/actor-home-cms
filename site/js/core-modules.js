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
    // 运行时国际化（i18n.js 同步加载在前），缺失时回退中文默认值
    const T = (window.I18N && window.I18N.t) || ((key, fallback) => (fallback == null ? key : fallback));
    const pick = (window.I18N && window.I18N.pick) || ((obj, field) => (obj && obj[field] != null ? obj[field] : ''));

window.CMS.registerModule('hero', function (mod) {
        const actor = C.actor || {};
        const hero = C.hero || {};
        const img = safeUrl(hero.image || actor.cover, 'image');
        const name = esc(actor.name || 'Actor');
        const nameEn = esc(actor.nameEn || '');
        const tagline = esc(pick(actor, 'tagline') || pick(actor, 'title') || '');
        // 移动端专属图：竖屏/横屏各可取一张（≤960px 时按方向切换显示；只配一张时两方向复用）
        let por = safeUrl((mod.imagesMobilePortrait && mod.imagesMobilePortrait[0]) || '', 'image');
        let land = safeUrl((mod.imagesMobileLandscape && mod.imagesMobileLandscape[0]) || '', 'image');
        if (por && !land) land = por;
        if (land && !por) por = land;
        const hasMobile = !!(por || land);
        return `
<section class="hero${hasMobile ? ' has-mobile-imgs' : ''}" id="hero" data-module="hero">
    <div class="hero__media">
        <img src="${img}" alt="${name}" onerror="this.parentElement.classList.add('is-empty')">
    </div>

    ${hasMobile ? `
    <div class="hero__mobile" aria-hidden="true">
        ${por ? `<img class="mobile-por" src="${por}" alt="${name}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : ''}
        ${land ? `<img class="mobile-land" src="${land}" alt="${name}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : ''}
    </div>` : ''}
    <div class="hero__content">
        <p class="hero__eyebrow">${nameEn}</p>
        <h1 class="hero__title">${name}</h1>
        <p class="hero__subtitle">${tagline}</p>
    </div>
</section>`;
    }, { nav: { href: '#hero', text: T('nav.home', '首页') } });

    window.CMS.registerModule('hero-split', function (mod) {
        const actor = C.actor || {};
        const hero = C.hero || {};
        const images = (mod.images && mod.images.length) ? mod.images : [hero.image, hero.image, hero.image, hero.image];
        const name = esc(actor.name || 'Actor');
        const nameEn = esc(actor.nameEn || '');
        const tagline = esc(pick(actor, 'tagline') || pick(actor, 'title') || '');
        let por = safeUrl((mod.imagesMobilePortrait && mod.imagesMobilePortrait[0]) || '', 'image');
        let land = safeUrl((mod.imagesMobileLandscape && mod.imagesMobileLandscape[0]) || '', 'image');
        if (por && !land) land = por;
        if (land && !por) por = land;
        const hasMobile = !!(por || land);
        return `
<section class="hero-split${hasMobile ? ' has-mobile-imgs' : ''}" id="hero-split" data-module="hero-split" data-hero-split>
    <div class="hero-split__columns">
        ${images.map((img, i) => `
            <div class="split-col${i === 0 ? ' is-active' : ''}" data-split-index="${i}">
                <img src="${safeUrl(img, 'image')}" alt="${name}" decoding="async" onerror="this.parentElement.classList.add('is-empty')">
                <span class="split-col__veil" aria-hidden="true"></span>
            </div>
        `).join('')}
    </div>
    ${hasMobile ? `
    <div class="hero-split__mobile" aria-hidden="true">
        ${por ? `<img class="mobile-por" src="${por}" alt="${name}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : ''}
        ${land ? `<img class="mobile-land" src="${land}" alt="${name}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : ''}
    </div>` : ''}
    <div class="hero-split__content">
        <p class="hero-split__eyebrow">${nameEn}</p>
        <h1 class="hero-split__title">${name}</h1>
        <p class="hero-split__subtitle">${tagline}</p>
    </div>
</section>`;
    }, { nav: { href: '#hero-split', text: T('nav.home', '首页') } });

    window.CMS.registerModule('about', function (mod) {
        if (!mod || mod.visible === false) return '';
        const actor = C.actor || {};
        const about = C.about || {};
        const visible = mod.visible !== false && about.visible !== false;
        if (!visible) return '';
        const bio = ((pick(about, 'bio') || []).length ? pick(about, 'bio') : (pick(actor, 'bio') || []));
        const stats = (about.stats && about.stats.length ? about.stats : actor.stats || []);
        const img = safeUrl(about.image || actor.avatar, 'image');
        const name = esc(actor.name || '');
        return `
<section class="section about" id="about" data-module="about">
    <div class="section__head">
        <p class="section__label">ABOUT</p>
        <h2 class="section__title">${esc(pick(about, 'heading') || T('about.title', '关于演员'))}</h2>
    </div>
    <div class="about__grid">
        <div class="about__image">
            <img src="${img}" alt="${name}" onerror="this.parentElement.classList.add('is-empty')">
        </div>
        <div class="about__body">
            <h3 class="about__name">${name}</h3>
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
</section>`;
    }, { nav: { href: '#about', text: T('nav.about', '关于') } });

    window.CMS.registerModule('works', function (mod) {
        if (!mod || mod.visible === false) return '';
        const works = C.works || {};
        const categories = Array.isArray(works.categories) && works.categories.length
            ? works.categories
            : (works.items || []).length ? [{ name: T('works.title', '代表作品'), items: works.items }] : [];
        const limit = mod.limit || 3;
        const heading = pick(works, 'heading') || T('works.title', '代表作品');

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
            const source = safeUrl(item.sourceUrl, 'link');
            const num = String(idx + 1).padStart(2, '0'); // 编号按排序后顺序
            return `
            <article class="work-item" data-index="${ci}-${ii}">
                <div class="work-item__num">${num}</div>
                <div class="work-item__media">
                    <img src="${poster}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')">
                </div>
                <div class="work-item__info">
                    <h3 class="work-item__title"><a class="work-item__link" href="/gallery.html${item.id ? `?work=${item.id}` : `?cat=${ci}&work=${ii}`}">${esc(item.title)}</a></h3>
                    <p class="work-item__meta">${esc(cat.name || item.type || '')} · ${esc(U.formatTime(item.year || item.releaseDate))} · ${esc(item.director || '')}</p>
                    <p class="work-item__role">${esc(T('works.rolePrefix', '饰演 '))}${esc(item.role || '')}</p>
                    <p class="work-item__synopsis">${esc(item.synopsis || '')}</p>
                    ${source ? `<p class="work-item__source"><a class="hover-underline" href="${source}" target="_blank" rel="noopener">${esc(T('common.originalLink', '原始链接 ↗'))}</a></p>` : ''}
                </div>
            </article>`;
        }).join('')}
    </div>
    ${hasAny ? `<div class="section__more"><a class="hover-underline" href="/works.html">${esc(T('works.viewAll', '查看全部作品'))}</a></div>` : ''}
</section>`;
    }, { nav: { href: '#works', text: T('nav.works', '作品') } });

    window.CMS.registerModule('images', function (mod) {
        if (!mod || mod.visible === false) return '';
        const label = mod.label || T('gallery.title', '写真');
        const layout = normalizeChoice(mod.layout, ['grid', 'wide', 'single'], 'grid');
        const limit = mod.limit || 8; // 首页写真集封面默认展示 8 个（后台模块管理可覆盖）
        const gallery = C.gallery || { albums: [] };
        const albums = Array.isArray(gallery.albums) ? gallery.albums : [];
        const isPrimaryImages = C.modules.findIndex(m => m.type === 'images') === C.modules.indexOf(mod);

        // 主写真模块：展示写真集封面（按发帖日期降序取最新 N 个；keep 原索引供 ?album= 链接回退）
        if (isPrimaryImages && albums.length) {
            const shown = albums
                .map((a, i) => ({ a, i }))
                .sort((x, y) => {
                    const dx = x.a.date || '', dy = y.a.date || '';
                    if (dx && dy) return dy.localeCompare(dx) || (y.i - x.i); // 有日期：降序，同日新加的在前
                    if (dx) return -1;                                       // 有日期优先
                    if (dy) return 1;
                    return y.i - x.i;                                        // 均无日期：新加的在前
                })
                .slice(0, limit);
            return `
<section class="section gallery" id="gallery" data-module="images">
    <div class="section__head">
        <p class="section__label">GALLERY</p>
        <h2 class="section__title">${esc(pick(gallery, 'heading') || label)}</h2>
    </div>
    <div class="gallery__albums">
        ${shown.map(({ a: album, i: ai }) => {
            const cover = safeUrl(album.cover || (album.images && album.images[0]), 'image');
            return `
                <a class="album-card" href="/gallery.html?album=${album.id || ai}">
                    <div class="album-card__cover">
                        <img src="${cover}" alt="${esc(pick(album, 'title') || T('gallery.albumFallback', '写真集'))}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')">
                    </div>
                    <h3 class="album-card__title">${esc(pick(album, 'title') || (T('gallery.albumFallback', '写真集') + ' ' + (ai + 1)))}</h3>
                    ${album.author ? `<span class="album-card__author">${esc(T('gallery.authorPrefix', '作者：'))}${esc(album.author)}</span>` : ''}
                    <span class="album-card__count">${(album.images || []).length}${esc(T('unit.photo', ' 张'))}</span>
                </a>
            `;
        }).join('')}
    </div>
    ${albums.length ? `<div class="section__more"><a class="hover-underline" href="/gallery.html">${esc(T('gallery.viewAll', '查看全部写真'))}</a></div>` : ''}
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
    ${allList.length ? `<div class="section__more"><a class="hover-underline" href="/gallery.html">${esc(T('gallery.viewAll', '查看全部写真'))}</a></div>` : ''}
</section>`;
    }, { nav: { href: '#gallery', text: T('nav.gallery', '写真') } });

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
        const allItems = (pluginData.items || []).slice().sort((a, b) => U.parseTime(b.date) - U.parseTime(a.date)); // 按时间降序（最新在前）
        const limit = mod.limit || 3;
        const items = allItems.slice(0, limit);
        const heading = pick(pluginData, 'heading') || T('news.title', '最新动态');
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
                    ${safeUrl(item.sourceUrl, 'link') ? `<p class="plugin-list__source"><a class="hover-underline" href="${safeUrl(item.sourceUrl, 'link')}" target="_blank" rel="noopener">${esc(T('common.originalLink', '原始链接 ↗'))}</a></p>` : ''}
                </div>
            </article>
        `).join('')}
    </div>
    ${allItems.length ? `<div class="section__more"><a class="hover-underline" href="/news.html">${esc(T('news.viewAll', '查看全部动态'))}</a></div>` : ''}
</section>`;
    }, { nav: { href: '#news', text: T('nav.news', '动态') } });

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
        <h2 class="section__title">${esc(pick(pluginData, 'heading') || T('awards.title', '荣誉奖项'))}</h2>
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
    ${allItems.length ? `<div class="section__more"><a class="hover-underline" href="/awards.html">${esc(T('awards.viewAll', '查看全部荣誉'))}</a></div>` : ''}
</section>`;
    }, { nav: { href: '#awards', text: T('nav.awards', '荣誉') } });

    window.CMS.registerModule('schedule', function (mod) {
        if (!mod || mod.visible === false) return '';
        const pluginData = (C.plugins && C.plugins.data && C.plugins.data['actor-schedule']) || {};
        const allItems = (pluginData.items || []).slice().sort((a, b) => U.parseTime(b.date) - U.parseTime(a.date)); // 按日期降序（最新在前）
        const limit = mod.limit || 3;
        const items = allItems.slice(0, limit);
        const announcements = pluginData.announcements || [];
        const latestAnnouncement = announcements[announcements.length - 1];
        if (!allItems.length && !latestAnnouncement) return '';
        return `
<section class="section section--plugin schedule" id="schedule" data-module="schedule">
    <div class="section__head">
        <p class="section__label">SCHEDULE</p>
        <h2 class="section__title">${esc(pick(pluginData, 'heading') || T('schedule.title', '近期行程'))}</h2>
    </div>
    ${latestAnnouncement ? `
    <div class="schedule-announcement">
        <p class="schedule-announcement__text">${esc(latestAnnouncement.text || '')}</p>
        ${safeUrl(latestAnnouncement.sourceUrl, 'link') ? `<p class="schedule-announcement__source"><a class="hover-underline" href="${safeUrl(latestAnnouncement.sourceUrl, 'link')}" target="_blank" rel="noopener">${esc(T('common.originalLink', '原始链接 ↗'))}</a></p>` : ''}
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
        `).join('')}
    </div>
    ${allItems.length ? `<div class="section__more"><a class="hover-underline" href="/schedule.html">${esc(T('schedule.viewAll', '查看全部行程'))}</a></div>` : ''}
</section>`;
    }, { nav: { href: '#schedule', text: T('nav.schedule', '行程') } });

    window.CMS.registerModule('footer', function () {
        const social = C.social || { links: [] };
        const footer = C.footer || {};
        const links = social.links || [];
        const copyright = footer.copyright || '';
        const disclaimer = String(pick(footer, 'disclaimer') || '').trim();
        // 版权链接：可配置多条；无效条目（文字与链接都为空）不渲染
        const copyLinks = (Array.isArray(footer.links) ? footer.links : [])
            .filter(l => l && (String(l.text || '').trim() || String(l.url || '').trim()));
        // 制作组：悬停固定条「©杉果派」弹出成员名单；点击仍照常跳转杉果派外链
        const credits = footer.credits || { members: [] };
        const creditsTitle = esc(String((pick(credits, 'title') || T('footer.creditsTitle', '制作组')) + '').trim() || T('footer.creditsTitle', '制作组'));
        const creditMembers = (Array.isArray(credits.members) ? credits.members : [])
            .filter(m => m && String(m.name || '').trim());
        const parts = [];
        if (copyright) parts.push(esc(copyright));
        copyLinks.forEach(l => {
            const url = safeUrl(l.url, 'link');
            const text = esc(String(l.text || l.url || '').trim());
            const isFixed = l.text === '©杉果派';
            if (isFixed) {
                parts.push(`<span class="footer__credits" id="footerCredits">
                <a class="footer__copy-link footer__credits-trigger" href="${url}" target="_blank" rel="noopener noreferrer" tabindex="0">${text}</a>
                <span class="footer__credits-popup" role="tooltip">
                    <span class="footer__credits-title">${creditsTitle}</span>
                    ${creditMembers.length ? `
                    <span class="footer__credits-list">
                        ${creditMembers.map(m => {
                            const name = esc(String(m.name || '').trim());
                            const roleText = esc(String(m.role || '').trim());
                            const mLink = safeUrl(m.link, 'link');
                            return `
                        <span class="footer__credits-member">
                            ${mLink ? `<a class="footer__credits-name" href="${mLink}" target="_blank" rel="noopener noreferrer">${name}</a>` : `<span class="footer__credits-name">${name}</span>`}
                            ${roleText ? `<span class="footer__credits-role">${roleText}</span>` : ''}
                        </span>`;
                        }).join('')}
                    </span>` : ''}
                </span>
            </span>`);
            } else {
                parts.push(url
                    ? `<a class="footer__copy-link" href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
                    : `<span class="footer__copy-text">${text}</span>`);
            }
        });
        // 免责声明：紧跟版权文字末尾，悬停/聚焦/点击展示全文
        if (disclaimer) {
            parts.push(`<span class="footer__disclaimer" id="footerDisclaimer">
                <span class="footer__disclaimer-trigger" tabindex="0" role="button" aria-expanded="false">${esc(T('footer.disclaimer', '免责声明'))}</span>
                <span class="footer__disclaimer-tip" role="tooltip">${esc(disclaimer)}</span>
            </span>`);
        }
        return `
<footer class="footer" id="footer" data-module="footer">
    <div class="footer__inner">
        <p class="footer__brand">${esc((C.actor && C.actor.nameEn) || '')}</p>
        <div class="footer__social">
            ${links.map(l => `<a href="${safeUrl(l.url, 'link') || '#'}" target="_blank" rel="noopener noreferrer">${esc(l.name)}</a>`).join('')}
            <button type="button" class="footer__share" id="footerShare" aria-label="${esc(T('footer.shareSite', '分享本站'))}" title="${esc(T('footer.shareSite', '分享本站'))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.4 13.3l7.2 4.2M15.6 6.5L8.4 10.7"/></svg>
            </button>
        </div>
        <p class="footer__copy">${parts.join('<span class="footer__copy-sep"> · </span>')}</p>
    </div>
</footer>`;
    }, { nav: { href: '#footer', text: T('nav.footer', '联系') } });

    /* 粉丝群组：首页展示预览（限量），完整列表与筛选在独立页面 /groups.html。
       与「写真」模块同模式：导航指向独立页，首页给预览 + 「查看全部」入口。 */
    window.CMS.registerModule('fanGroups', function (mod) {
        if (!mod || mod.visible === false) return '';
        const fg = C.fanGroups || {};
        const groups = window.CMS.fanGroupList(fg);
        if (!groups.length) return '';                 // 无群组：首页不渲染该板块
        const limit = mod.limit || 6;
        const shown = groups.slice(0, limit);
        const heading = String(pick(fg, 'heading') || T('groups.title', '粉丝群组')).trim() || T('groups.title', '粉丝群组');
        const desc = String(pick(fg, 'desc') || '').trim();
        return `
<section class="section fan-groups" id="fanGroups" data-module="fanGroups">
    <div class="section__head">
        <p class="section__label">COMMUNITY</p>
        <h2 class="section__title">${esc(heading)}</h2>
    </div>
    ${desc ? `<div class="fan-groups__desc">${sanitizeHtml(desc)}</div>` : ''}
    <div class="fan-groups__list">
        ${shown.map(g => window.CMS.fanGroupCardHtml(g)).join('')}
    </div>
    ${groups.length > shown.length || groups.length ? `<div class="section__more"><a class="hover-underline" href="/groups.html">${esc(T('groups.viewAll', '查看全部群组'))}</a></div>` : ''}
</section>`;
    }, { nav: { href: '/groups.html', text: T('nav.groups', '群组') } });

})();
