/**
 * Actor Home CMS — 首页渲染引擎
 * 内置核心模块位于 core-modules.js，插件模块通过 CMS.registerModule 注册。
 */
(function () {
    'use strict';

    const C = SITE_CONFIG;
    const U = window.CMS.utils;
    const esc = U.esc;

    // 静态站点不依赖插件客户端；所有页面模块均由内置 core-modules.js 提供
    function rebuildNav(visibleModules) {
        const container = document.getElementById('navLinks');
        const logo = document.getElementById('navLogo');
        if (!container) return;
        const links = visibleModules.map(mod => {
            const nav = window.CMS.getNav(mod.type);
            if (!nav) return '';
            return `<li><a class="nav__link" href="${esc(nav.href)}">${esc(nav.text)}</a></li>`;
        }).join('');
        container.innerHTML = links;
        if (logo && C.actor && C.actor.nameEn) logo.textContent = C.actor.nameEn;
    }

    function initHeroSplit() {
        document.querySelectorAll('[data-hero-split]').forEach(section => {
            const cols = Array.from(section.querySelectorAll('.split-col'));
            if (!cols.length) return;

            let activeIndex = 0;
            let rafId = 0;
            let pointer = null; // 每帧只取最新一次指针坐标

            // 只在目标列确实变化时才操作 DOM
            const activate = (i, force) => {
                if (i === activeIndex && !force) return;
                activeIndex = i;
                cols.forEach((col, idx) => col.classList.toggle('is-active', idx === i));
            };

            // 用几何计算代替 elementFromPoint（每帧最多一次 getBoundingClientRect）
            const resolveIndex = (x, y) => {
                const rect = section.getBoundingClientRect();
                if (y < rect.top || y > rect.bottom || x < rect.left || x > rect.right) return activeIndex;
                let acc = rect.left;
                for (let i = 0; i < cols.length; i++) {
                    const w = cols[i].getBoundingClientRect().width;
                    if (x < acc + w) return i;
                    acc += w;
                }
                return cols.length - 1;
            };

            const frame = () => {
                rafId = 0;
                if (!pointer) return;
                const p = pointer;
                pointer = null;
                activate(resolveIndex(p.x, p.y));
            };

            // 高频事件只记坐标，合并到下一帧处理
            const schedule = (x, y) => {
                pointer = { x, y };
                if (!rafId) rafId = requestAnimationFrame(frame);
            };

            section.addEventListener('mousemove', e => schedule(e.clientX, e.clientY));
            section.addEventListener('mouseleave', () => { pointer = null; activate(0); });
            section.addEventListener('touchstart', e => {
                if (e.touches.length) schedule(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: true });
            section.addEventListener('touchmove', e => {
                if (e.touches.length) schedule(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: true });
            activate(0, true);
        });
    }

    function bindNav() {
        const nav = document.getElementById('nav');
        if (!nav) return;
        const onScroll = () => {
            const scrolled = window.scrollY > 80;
            nav.classList.toggle('nav--scrolled', scrolled);
            nav.classList.toggle('nav--hidden', !scrolled);
            nav.classList.toggle('nav--visible', scrolled);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        const toggle = document.getElementById('navToggle');
        const links = document.getElementById('navLinks');
        if (!toggle || !links) return;
        const close = () => {
            links.classList.remove('nav__links--open');
            toggle.classList.remove('nav__toggle--active');
            toggle.setAttribute('aria-expanded', 'false');
        };
        toggle.addEventListener('click', () => {
            const open = links.classList.toggle('nav__links--open');
            toggle.classList.toggle('nav__toggle--active', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        links.addEventListener('click', e => {
            if (e.target.closest('.nav__link')) close();
        });
    }

    function initReveal() {
        // 注意：主题 CSS 可能把 album-card 也设为初始隐藏，需一并监听揭示
        const targets = document.querySelectorAll('.section__head, .work-item, .gallery__item, .news-item, .award-item, .schedule-item, .album-card');
        if (typeof window.IntersectionObserver === 'undefined') {
            targets.forEach(el => el.classList.add('is-visible'));
            return;
        }
        const io = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                io.unobserve(entry.target);
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
        targets.forEach(el => io.observe(el));
    }

    async function init() {
        const app = document.getElementById('app');
        if (!app) return;

        window.CMS.runHook('beforeRender');

        const modules = (C.modules || []).filter(m => m.visible !== false && window.CMS.hasRenderer(m.type));
        app.innerHTML = modules.map((mod, idx) => {
            const render = window.CMS.getRenderer(mod.type);
            return render ? render(mod, idx) || '' : '';
        }).join('');

        if (C.actor && C.actor.name) {
            document.title = C.actor.name + (C.actor.tagline ? ' | ' + C.actor.tagline : '');
        }

        rebuildNav(modules);
        bindNav();
        initHeroSplit();
        initReveal();
        window.CMS.runHook('afterRender', { modules });
    }

    init();
})();
