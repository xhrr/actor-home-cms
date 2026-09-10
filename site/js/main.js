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
            // 文案跟随后台「区域标题」（getNav 里是硬编码默认短名，此处覆盖）
            const text = window.CMS.navLabel ? window.CMS.navLabel(mod.type, nav.text) : nav.text;
            return `<li><a class="nav__link" href="${esc(nav.href)}">${esc(text)}</a></li>`;
        }).join('');
        container.innerHTML = links;
        if (logo && C.actor && C.actor.nameEn) logo.textContent = C.actor.nameEn;
    }

    /* ---------- Hero 图片入场 ----------
       图片加载完成后淡入 + 从下往上位移 + 缓慢放大归位（避免整块 hero 一起出现）。
       注：退场动效已移除（站长反馈效果不佳），仅保留入场。 */
    function initHeroEnter() {
        const hero = document.querySelector('.hero');
        if (!hero) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            hero.classList.add('hero-enter');
            return;
        }
        const img = hero.querySelector('.hero__media img');
        // 加 .hero-enter 即触发入场动画（CSS @keyframes）；不加则图片默认可见，脚本异常也不会永久透明
        let entered = false;
        const enter = () => {
            if (entered) return; // 幂等：load / error / 超时可能都触发
            entered = true;
            // @keyframes 加类即播放，无需分帧/强制回流
            hero.classList.add('hero-enter');
        };
        if (img) {
            // 图片已缓存则立即入场；否则等 load（最多等 1.5s，避免慢图卡住内容）
            if (img.complete && img.naturalWidth > 0) enter();
            else {
                img.addEventListener('load', enter, { once: true });
                img.addEventListener('error', enter, { once: true });
                setTimeout(enter, 1500);
            }
        } else {
            enter();
        }
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

            // 触屏设备禁用分栏跟随：手指滑动的本意是滚动页面，touchmove 高频切列
            // 会连续触发整列宽度 transition（layout 级重排），是移动端掉帧大户
            if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
                activate(0, true);
                return;
            }

            // 列几何缓存：只在初始化与 resize 时测量，pointer 移动时零布局查询
            let colGeom = null; // { left, right, top, bottom, widths: [] }
            const measure = () => {
                const rect = section.getBoundingClientRect();
                colGeom = {
                    left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                    widths: cols.map(c => c.getBoundingClientRect().width)
                };
            };
            measure();
            window.addEventListener('resize', () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; measure(); }); }, { passive: true });

            const resolveIndex = (x, y) => {
                if (!colGeom) return activeIndex;
                const g = colGeom;
                if (y < g.top || y > g.bottom || x < g.left || x > g.right) return activeIndex;
                let acc = g.left;
                for (let i = 0; i < g.widths.length; i++) {
                    if (x < acc + g.widths[i]) return i;
                    acc += g.widths[i];
                }
                return g.widths.length - 1;
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
        // 滚动状态统一交给 CMS.bindScrollState（单一监听 + rAF 节流）；
        // 此前这里与 cms.js 各注册一个 scroll 且阈值不同（80 vs 40），互相覆盖造成额外重绘
        if (window.CMS && typeof window.CMS.bindScrollState === 'function') window.CMS.bindScrollState(nav);

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

    /** 页脚免责声明：触屏点击切换，点击外部关闭（悬停/聚焦由 CSS 处理） */
    function initDisclaimer() {
        const d = document.getElementById('footerDisclaimer');
        if (!d) return;
        const trigger = d.querySelector('.footer__disclaimer-trigger');
        if (!trigger) return;
        const setOpen = open => {
            d.classList.toggle('is-open', open);
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        trigger.addEventListener('click', e => {
            e.preventDefault();
            setOpen(!d.classList.contains('is-open'));
        });
        document.addEventListener('click', e => {
            if (d.classList.contains('is-open') && !d.contains(e.target)) setOpen(false);
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

    /** 页脚分享图标：打开分享弹层（二维码 + 卡片图 + 复制链接） */
    function initShare() {
        // 海报地址：R2 图床外链（分享图上传自图床，横图 PC / 竖图手机）
        const SHARE_POSTERS = {
            vertical: '/uploads/share-poster-vertical.webp',
            horizontal: '/uploads/share-poster-horizontal.webp'
        };
        const btn = document.getElementById('footerShare');
        if (!btn) return;
        btn.addEventListener('click', () => {
            window.CMS.openShareModal({
                posterVertical: SHARE_POSTERS.vertical,
                posterHorizontal: SHARE_POSTERS.horizontal
            });
        });
    }

    async function init() {
        const app = document.getElementById('app');
        if (!app) return;

        window.CMS.runHook('beforeRender');

        // 图集数据已从主 config 拆出（data-gallery.js）：首页若有写真模块，先取回再渲染
        const modules = (C.modules || []).filter(m => m.visible !== false && window.CMS.hasRenderer(m.type));
        if (modules.some(m => m.type === 'images') && window.CMS.loadGallery) {
            await window.CMS.loadGallery();
        }

        app.innerHTML = modules.map((mod, idx) => {
            const render = window.CMS.getRenderer(mod.type);
            return render ? render(mod, idx) || '' : '';
        }).join('');

        if (C.actor && C.actor.name) {
            document.title = C.actor.name + (C.actor.tagline ? ' | ' + C.actor.tagline : '');
        }

        rebuildNav(modules);
        bindNav();
        initHeroEnter();
        initHeroSplit();
        initDisclaimer();
        initShare();
        initReveal();
        window.CMS.runHook('afterRender', { modules });
    }

    init();
})();
