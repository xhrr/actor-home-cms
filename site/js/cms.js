/**
 * CMS 前端运行时
 * 负责模块注册、工具函数、插件客户端脚本加载。
 */
(function () {
    'use strict';

    // JS 可用标记：图片加载淡入等渐进增强以 .js 作选择器门控
    document.documentElement.classList.add('js');
    // 捕获阶段监听 load（load 不冒泡）：画廊图片加载完成后淡入
    document.addEventListener('load', function (e) {
        const t = e.target;
        if (t && t.tagName === 'IMG' && t.closest('.gallery__item, .album-card__cover')) t.classList.add('is-loaded');
    }, true);

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
        // 完整日期：2024-05-01 / 2024/5/1 / 2024.5.1 / 2024年5月1日
        const m = str.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
        if (m) {
            const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
            return isNaN(t) ? 0 : t;
        }
        // 年月：2024-05 / 2024.05 / 2024年5月
        const ym = str.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/);
        if (ym) {
            const t = new Date(+ym[1], +ym[2] - 1, 1).getTime();
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

    /* 图集数据懒加载：data-gallery.js 从主 config 拆出（体量最大），用时才取。
       页面已直接引入该脚本、或已加载过 → 立即 resolve；失败也不阻断渲染，
       调用方取到空 albums 降级显示，而不是整页报错。 */
    let galleryPromise = null;
    function loadGallery() {
        if (galleryPromise) return galleryPromise;
        const g = window.SITE_CONFIG && window.SITE_CONFIG.gallery;
        if (g && Array.isArray(g.albums)) { galleryPromise = Promise.resolve(); return galleryPromise; }
        galleryPromise = loadScript('/js/data-gallery.js').catch(err => {
            console.error('[cms] 图集数据加载失败：', err && err.message);
        });
        return galleryPromise;
    }

    function escNav(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    /* 全局滚动状态：单一监听 + rAF 节流（避免多处监听同一状态互相覆盖、每帧多次布局）
       alwaysVisible：子页面导航常显——子页面没有满屏 hero，顶部即内容，
       沿用首页"顶部隐藏下滑显示"反而让导航找不到 */
    let scrollRaf = null;
    function bindScrollState(nav, alwaysVisible) {
        const apply = () => {
            scrollRaf = null;
            const scrolled = window.scrollY > 40;
            nav.classList.toggle('nav--scrolled', scrolled);
            nav.classList.toggle('nav--hidden', !alwaysVisible && !scrolled);
            nav.classList.toggle('nav--visible', alwaysVisible || scrolled);
        };
        const onScroll = () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(apply); };
        window.addEventListener('scroll', onScroll, { passive: true });
        apply();
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
        // 滚动状态统一由 window.CMS.bindScrollState 管理（rAF 节流 + 单一监听）：
        // 此前 cms.js(阈值 40) 与 main.js(阈值 80) 各自注册 scroll 并操作同一个 nav--scrolled，互相覆盖
        if (window.CMS && typeof window.CMS.bindScrollState === 'function') {
            window.CMS.bindScrollState(nav, true); // 子页面：导航常显
        } else {
            const onScroll = () => nav.classList.toggle('nav--scrolled', window.scrollY > 40);
            window.addEventListener('scroll', onScroll, { passive: true });
            onScroll();
        }
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

    /** 模块类型 → 导航文案：跟随后台「区域标题」(config 里各分区的 heading)，
     *  未配置则用调用方给的默认短名。首页锚点导航与子页面链接导航共用，保证两处一致。 */
    function navLabel(type, fallback) {
        const C = window.SITE_CONFIG || {};
        const pd = (C.plugins && C.plugins.data) || {};
        const pick = v => { const s = String(v == null ? '' : v).trim(); return s || fallback; };
        switch (type) {
            case 'about': return pick(C.about && C.about.heading);
            case 'works': return pick(C.works && C.works.heading);
            case 'images': return pick(C.gallery && C.gallery.heading);
            case 'news': return pick((pd['actor-news'] || {}).heading);
            case 'awards': return pick((pd['actor-awards'] || {}).heading);
            case 'schedule': return pick((pd['actor-schedule'] || {}).heading);
            default: return fallback;
        }
    }

    function buildNavLinks() {
        const C = window.SITE_CONFIG || {};
        const mods = C.modules || [];
        const vis = type => mods.some(m => m.type === type && m.visible !== false);
        const links = [];
        if (vis('hero') || vis('hero-split')) links.push({ href: '/', text: '首页' });
        if (vis('about')) links.push({ href: '/about.html', text: navLabel('about', '关于') });
        if (vis('works')) links.push({ href: '/works.html', text: navLabel('works', '作品') });
        if (vis('images')) links.push({ href: '/gallery.html', text: navLabel('images', '写真') });
        if (vis('news')) links.push({ href: '/news.html', text: navLabel('news', '动态') });
        if (vis('awards')) links.push({ href: '/awards.html', text: navLabel('awards', '荣誉') });
        if (vis('schedule')) links.push({ href: '/schedule.html', text: navLabel('schedule', '行程') });
        if (vis('footer')) links.push({ href: '/#footer', text: '联系' });
        return links;
    }

    /* ---------- 分享弹层：二维码 + 卡片图 + 复制链接 ---------- */

    function legacyCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return ok;
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
        }
        return Promise.resolve(legacyCopy(text));
    }

    function closeShareModal() {
        const m = document.getElementById('shareModal');
        if (!m) return;
        m.classList.remove('is-open');
        document.body.style.overflow = '';
    }

    function ensureShareModal() {
        let m = document.getElementById('shareModal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'shareModal';
        m.className = 'share-modal';
        m.innerHTML = `
            <div class="share-modal__backdrop"></div>
            <div class="share-modal__card" role="dialog" aria-modal="true" aria-label="分享">
                <button type="button" class="share-modal__close" aria-label="关闭">×</button>
                <p class="share-modal__eyebrow">SHARE</p>
                <div class="share-modal__poster"></div>
                <p class="share-modal__hint">海报生成中…</p>
                <div class="share-modal__actions">
                    <button type="button" class="share-modal__download">保存图片</button>
                    <button type="button" class="share-modal__copy">复制链接</button>
                </div>
            </div>`;
        document.body.appendChild(m);
        m.querySelector('.share-modal__backdrop').addEventListener('click', closeShareModal);
        m.querySelector('.share-modal__close').addEventListener('click', closeShareModal);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeShareModal(); });
        m.querySelector('.share-modal__copy').addEventListener('click', () => {
            const btn = m.querySelector('.share-modal__copy');
            copyToClipboard(m.dataset.url || window.location.href).then(ok => {
                btn.textContent = ok ? '已复制 ✓' : '复制失败';
                setTimeout(() => { btn.textContent = '复制链接'; }, 1600);
            });
        });
        return m;
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('image load failed'));
            im.src = src;
        });
    }

    /** 打开分享弹层：按屏幕横竖选择站长预制的分享海报（二维码已烙入图中），一键保存。
     * opts = { posterVertical, posterHorizontal }，缺省时仅保留复制链接 */
    function openShareModal(opts) {
        opts = opts || {};
        const m = ensureShareModal();
        m.dataset.url = opts.url || window.location.href;
        const portrait = window.innerHeight >= window.innerWidth;
        const poster = portrait ? opts.posterVertical : opts.posterHorizontal;
        const box = m.querySelector('.share-modal__poster');
        box.innerHTML = '';
        const hint = m.querySelector('.share-modal__hint');
        const dl = m.querySelector('.share-modal__download');
        hint.textContent = '';
        if (poster) {
            loadImage(poster).then(() => {
                const im = document.createElement('img');
                im.src = poster;
                im.alt = '分享海报';
                box.appendChild(im);
                dl.style.display = '';
                // 海报可能放在跨域图床：优先 fetch→blob 直接下载，受限时新标签打开（长按/右键另存）
                dl.onclick = () => {
                    const name = 'share-poster-' + (portrait ? 'vertical' : 'horizontal') + (poster.match(/\.\w+$/) || ['.jpg'])[0];
                    fetch(poster, { mode: 'cors' }).then(r => {
                        if (!r.ok) throw new Error('http ' + r.status);
                        return r.blob();
                    }).then(blob => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = name;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
                    }).catch(() => {
                        window.open(poster, '_blank');
                    });
                };
            }).catch(() => {
                hint.textContent = '海报加载失败，可直接复制链接';
                dl.style.display = 'none';
            });
        } else {
            dl.style.display = 'none';
            hint.textContent = '未配置分享海报，可直接复制链接';
        }
        m.classList.add('is-open');
        document.body.style.overflow = 'hidden';
    }

    window.CMS = {
        registerModule,
        registerNav,
        getRenderer,
        getNav,
        navLabel,
        hasRenderer,
        on,
        runHook,
        loadScript,
        loadGallery,
        buildNavLinks,
        initNavShell,
        bindScrollState,
        revealNow,
        openShareModal,
        copyToClipboard,
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
