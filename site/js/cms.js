/**
 * CMS 前端运行时
 * 负责模块注册、工具函数、插件客户端脚本加载。
 */
(function () {
    'use strict';

    const R = {};
    const NAV = {};
    const hooks = {
        beforeRender: [],
        afterRender: []
    };

    function esc(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function cleanUrl(value, kind) {
        if (typeof value !== 'string') return '';
        const raw = value.trim();
        if (!raw) return '';
        if (raw[0] === '#') return raw;
        if (raw[0] === '/' && raw[1] !== '/') return raw;
        try {
            const url = new URL(raw, window.location.origin);
            const allowed = kind === 'image'
                ? ['http:', 'https:', 'data:']
                : ['http:', 'https:', 'mailto:', 'tel:'];
            if (allowed.indexOf(url.protocol) === -1) return '';
            if (url.protocol === 'data:' && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(raw)) return '';
            return raw;
        } catch (e) {
            return '';
        }
    }

    function safeUrl(value, kind) {
        return esc(cleanUrl(value, kind));
    }

    function normalizeChoice(value, allowed, fallback) {
        return allowed.indexOf(value) >= 0 ? value : fallback;
    }

    /**
     * 解析上映时间字符串 → 时间戳。
     * 支持：2024 / 2024-05-01 / 2024/5/1 / 2024.5.1 / 2024年5月1日
     * 解析失败返回 0（排序时排最后）。
     */
    function parseTime(value) {
        const str = String(value || '').trim();
        if (!str) return 0;
        const m = str.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
        if (m) {
            const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
            return isNaN(t) ? 0 : t;
        }
        const y = str.match(/^(\d{4})/);
        if (y) {
            const t = new Date(+y[1], 0, 1).getTime();
            return isNaN(t) ? 0 : t;
        }
        return 0;
    }

    /** 格式化上映时间：纯年份原样；含日期显示为 2024.05.01 */
    function formatTime(value) {
        const str = String(value || '').trim();
        if (!str) return '';
        const m = str.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
        if (m) {
            const pad = n => String(n).padStart(2, '0');
            return `${m[1]}.${pad(+m[2])}.${pad(+m[3])}`;
        }
        const y = str.match(/^(\d{4})/);
        return y ? y[1] : str;
    }

    /** 按时间排序（降序：新的在前），无时间的排最后；返回排序后的副本 */
    function sortByTime(items, getValue) {
        return items.slice().sort((a, b) => {
            const ta = parseTime(getValue ? getValue(a) : (a.year || a.releaseDate));
            const tb = parseTime(getValue ? getValue(b) : (b.year || b.releaseDate));
            return tb - ta;
        });
    }

    function sanitizeHtml(html) {
        if (typeof html !== 'string' || !html.trim()) return '';
        const template = document.createElement('template');
        template.innerHTML = html;
        const allowedTags = {
            A: ['href', 'title', 'target', 'rel'],
            B: [], STRONG: [], I: [], EM: [], U: [], BR: [],
            P: [], H1: [], H2: [], H3: [], H4: [],
            UL: [], OL: [], LI: [], BLOCKQUOTE: [],
            FIGURE: [], FIGCAPTION: [],
            IMG: ['src', 'alt', 'title', 'loading'],
            SPAN: [], SMALL: [], CODE: [], PRE: []
        };

        Array.from(template.content.querySelectorAll('*')).forEach(function (node) {
            if (!allowedTags[node.tagName]) {
                node.replaceWith.apply(node, Array.from(node.childNodes));
                return;
            }
            Array.from(node.attributes).forEach(function (attr) {
                const name = attr.name.toLowerCase();
                if (name.indexOf('on') === 0 || name === 'style' || name === 'class' || name === 'id') {
                    node.removeAttribute(attr.name);
                    return;
                }
                if (allowedTags[node.tagName].indexOf(name) === -1) {
                    node.removeAttribute(attr.name);
                    return;
                }
                if (name === 'href') {
                    const href = cleanUrl(attr.value, 'link');
                    href ? node.setAttribute('href', href) : node.removeAttribute('href');
                }
                if (name === 'src') {
                    const src = cleanUrl(attr.value, 'image');
                    src ? node.setAttribute('src', src) : node.removeAttribute('src');
                }
            });
            if (node.tagName === 'A') {
                node.setAttribute('rel', 'noopener noreferrer');
                if (node.getAttribute('target') !== '_blank') node.removeAttribute('target');
            }
            if (node.tagName === 'IMG' && !node.getAttribute('loading')) {
                node.setAttribute('loading', 'lazy');
            }
        });
        return template.innerHTML;
    }

    function registerModule(type, renderer, options) {
        if (!type || typeof renderer !== 'function') return;
        R[type] = renderer;
        if (options && options.nav) {
            NAV[type] = options.nav;
        }
    }

    function registerNav(type, navItem) {
        if (type && navItem) NAV[type] = navItem;
    }

    function getRenderer(type) {
        return R[type] || null;
    }

    function getNav(type) {
        return NAV[type] || null;
    }

    function hasRenderer(type) {
        return typeof R[type] === 'function';
    }

    function on(event, fn) {
        if (hooks[event] && typeof fn === 'function') hooks[event].push(fn);
    }

    function runHook(event, ...args) {
        (hooks[event] || []).forEach(fn => {
            try { fn(...args); } catch (e) { console.error('[cms:hook]', event, e); }
        });
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-plugin-src="${src}"]`);
            if (existing) {
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
                if (existing.dataset.loaded === 'true') return resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.dataset.pluginSrc = src;
            script.async = false;
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                resolve();
            });
            script.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
            document.head.appendChild(script);
        });
    }

    function escNav(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function initNavShell() {
        const C = window.SITE_CONFIG || {};
        const logo = document.getElementById('navLogo');
        const links = document.getElementById('navLinks');
        if (logo && C.actor) logo.textContent = C.actor.nameEn || '';
        if (links) {
            links.innerHTML = buildNavLinks().map(l => `<li><a class="nav__link" href="${escNav(l.href)}">${escNav(l.text)}</a></li>`).join('');
        }
        const nav = document.getElementById('nav');
        if (!nav) return;
        const onScroll = () => nav.classList.toggle('nav--scrolled', window.scrollY > 40);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        const toggle = document.getElementById('navToggle');
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

    function revealNow(root) {
        if (!root) return;
        Array.prototype.forEach.call(root.querySelectorAll('.section__head, .work-item, .gallery__item, .news-item, .award-item, .schedule-item, .album-card'), el => {
            el.classList.add('is-visible');
        });
    }

    function buildNavLinks() {
        const C = window.SITE_CONFIG || {};
        const mods = C.modules || [];
        const vis = type => mods.some(m => m.type === type && m.visible !== false);
        const links = [];
        if (vis('hero') || vis('hero-split')) links.push({ href: '/', text: '首页' });
        if (vis('about')) links.push({ href: '/about.html', text: '关于' });
        if (vis('works')) links.push({ href: '/works.html', text: '作品' });
        if (vis('images')) links.push({ href: '/gallery.html', text: '写真' });
        if (vis('news')) links.push({ href: '/news.html', text: '动态' });
        if (vis('awards')) links.push({ href: '/awards.html', text: '荣誉' });
        if (vis('schedule')) links.push({ href: '/schedule.html', text: '行程' });
        if (vis('footer')) links.push({ href: '/#footer', text: '联系' });
        return links;
    }

    window.CMS = {
        registerModule,
        registerNav,
        getRenderer,
        getNav,
        hasRenderer,
        on,
        runHook,
        loadScript,
        buildNavLinks,
        initNavShell,
        revealNow,
        utils: {
            esc,
            cleanUrl,
            safeUrl,
            normalizeChoice,
            sanitizeHtml,
            parseTime,
            formatTime,
            sortByTime
        }
    };
})();
