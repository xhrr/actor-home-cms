(function () {
    'use strict';

    const C = SITE_CONFIG;
    const U = window.CMS.utils;
    const esc = U.esc;
    const safeUrl = U.safeUrl;
    // 运行时国际化（i18n.js 同步加载在前），缺失时回退中文默认值
    const T = (window.I18N && window.I18N.t) || ((key, fallback) => (fallback == null ? key : fallback));
    const pick = (window.I18N && window.I18N.pick) || ((obj, field) => (obj && obj[field] != null ? obj[field] : ''));

    const top = document.getElementById('galleryTop');
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    const params = new URLSearchParams(window.location.search);
    const albumRef = params.get('album');
    const catIndex = params.get('cat');
    const workRef = params.get('work');
    // 老链接兜底：无稳定 ID 的老作品走 ?cat=N&work=M 数字索引（page.js 仍会生成该格式），缺此解析会 ReferenceError 整页崩
    const workIndex = workRef !== null && /^\d+$/.test(workRef) ? parseInt(workRef, 10) : null;

    // 图集数据已从主 config 拆出（data-gallery.js）；下方入口会在懒加载完成后再赋值。
    let gallery = C.gallery || { heading: T('gallery.title', '写真'), albums: [] };
    let albums = Array.isArray(gallery.albums) ? gallery.albums : [];

    /** 从 SITE_CONFIG 重新读取图集数据（懒加载完成后调用） */
    function refreshGalleryData() {
        gallery = C.gallery || { heading: T('gallery.title', '写真'), albums: [] };
        albums = Array.isArray(gallery.albums) ? gallery.albums : [];
    }

    /** 解析相册：优先稳定 ID，数字参数按索引兜底（老链接兼容） */
    function resolveAlbum(ref) {
        let ai = albums.findIndex(a => a.id && a.id === ref);
        if (ai < 0 && /^\d+$/.test(String(ref))) ai = parseInt(ref, 10);
        return { album: albums[ai] || null, ai };
    }
    const works = C.works || {};
    const categories = Array.isArray(works.categories) && works.categories.length
        ? works.categories
        : (works.items || []).length ? [{ name: T('works.title', '代表作品'), items: works.items }] : [];

    /* ---------- 通用导航 ---------- */

    function setupNav() {
        window.CMS.initNavShell();
    }

    /* ---------- 灯箱（支持左右切换） ---------- */

    // 当前视图的图片列表与索引（渲染时维护）
    let curImages = [];
    let curIndex = -1;
    let touchStartX = null;

    function bindLightbox() {
        const lightbox = document.getElementById('lightbox');
        const lightboxImg = document.getElementById('lightbox-img');
        const counterEl = document.getElementById('lightbox-counter');
        const prevBtn = document.getElementById('lightbox-prev');
        const nextBtn = document.getElementById('lightbox-next');
        if (!lightbox || !lightboxImg) return;

        function syncNav() {
            const multi = curImages.length > 1 && curIndex >= 0;
            if (prevBtn) prevBtn.style.display = multi ? '' : 'none';
            if (nextBtn) nextBtn.style.display = multi ? '' : 'none';
            if (counterEl) counterEl.textContent = multi ? (curIndex + 1) + ' / ' + curImages.length : '';
            counterEl.style.display = multi ? '' : 'none';
        }

        let closeTimer = null;

        function open(src) {
            curIndex = curImages.indexOf(src);
            lightboxImg.src = src;
            zmReset(); // 换图复位缩放（function 声明提升，定义见下方缩放模块）
            lightbox.style.display = 'flex';
            void lightbox.offsetWidth; // 强制回流：让 .is-open 的淡入过渡从关闭态起始
            lightbox.classList.add('is-open');
            document.body.style.overflow = 'hidden';
            syncNav();
            prefetchNeighbors();
        }

        function show(i, dir) {
            if (i < 0 || i >= curImages.length) return;
            curIndex = i;
            lightboxImg.src = curImages[i];
            zmReset(); // 切换图片复位缩放
            playSwap(dir);
            syncNav();
            prefetchNeighbors();
        }

        // 左右切换方向滑入：移除动画类→强制回流→按方向重挂
        function playSwap(dir) {
            if (!dir) return;
            lightboxImg.classList.remove('swap-next', 'swap-prev');
            void lightboxImg.offsetWidth;
            lightboxImg.classList.add(dir === 'prev' ? 'swap-prev' : 'swap-next');
        }

        function prev() { show(curIndex - 1, 'prev'); }
        function next() { show(curIndex + 1, 'next'); }

        function prefetchNeighbors() {
            [curIndex - 1, curIndex + 1].forEach(i => {
                if (i < 0 || i >= curImages.length) return;
                const im = new Image();
                im.src = curImages[i];
            });
        }

        function close() {
            zmReset(); // 关闭复位缩放，避免下次打开残留
            lightbox.classList.remove('is-open');
            document.body.style.overflow = '';
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
                if (!lightbox.classList.contains('is-open')) {
                    lightbox.style.display = 'none';
                    lightboxImg.src = '';
                }
            }, 360);
        }

        // 事件委托：瀑布流条目为渐进插入，统一在网格上代理点击
        grid.addEventListener('click', e => {
            const img = e.target.closest('.gallery__item img');
            if (img) open(img.currentSrc || img.src);
        });

        const closeBtn = document.getElementById('lightbox-close');
        if (closeBtn) closeBtn.addEventListener('click', close);

        if (prevBtn) prevBtn.addEventListener('click', e => { e.stopPropagation(); prev(); });
        if (nextBtn) nextBtn.addEventListener('click', e => { e.stopPropagation(); next(); });

        lightbox.addEventListener('click', e => {
            // 只点背景关闭：图片区域留给双击缩放，避免缩放/平移后误触关闭
            if (e.target === lightbox) close();
        });

        document.addEventListener('keydown', e => {
            if (lightbox.style.display === 'none') return;
            if (e.key === 'Escape') close();
            if (zm.s > 1) return; // 缩放态下不切换（防平移查看时误翻页）
            if (e.key === 'ArrowLeft') prev();
            if (e.key === 'ArrowRight') next();
        });

        /* ---------- 图片缩放：双击 / 双指捏合 / 滚轮 + 拖拽平移 ----------
           transform-origin 50% 50%，焦点缩放公式（全视口坐标，无需换算）：
           t1 = t0 + (F - C) × (1 - s1/s0)（F=焦点视口坐标，C=图片当前中心） */
        const ZM_MAX = 4, ZM_DBL = 2.5;
        let zm = { s: 1, tx: 0, ty: 0 };

        function zmApply(animate) {
            lightboxImg.style.transition = animate ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
            lightboxImg.style.transform = 'translate(' + zm.tx + 'px, ' + zm.ty + 'px) scale(' + zm.s + ')';
            lightbox.classList.toggle('lightbox--zoomed', zm.s > 1.05);
        }

        function zmClampPan() {
            if (zm.s <= 1) { zm.tx = 0; zm.ty = 0; return; }
            const r = lightboxImg.getBoundingClientRect(); // 已含 scale，除回原始尺寸
            const w = r.width / zm.s, h = r.height / zm.s;
            const mx = (w * zm.s - w) / 2, my = (h * zm.s - h) / 2;
            zm.tx = Math.max(-mx, Math.min(mx, zm.tx));
            zm.ty = Math.max(-my, Math.min(my, zm.ty));
        }

        function zmReset() {
            zm = { s: 1, tx: 0, ty: 0 };
            zmApply(false);
        }

        function zmZoomTo(s1, fx, fy, animate) {
            s1 = Math.max(1, Math.min(ZM_MAX, s1));
            const r = lightboxImg.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const k = 1 - s1 / zm.s;
            zm.tx += (fx - cx) * k;
            zm.ty += (fy - cy) * k;
            zm.s = s1;
            zmClampPan();
            zmApply(animate);
        }

        // 桌面双击：1x ↔ 2.5x，以双击点为焦点
        lightboxImg.addEventListener('dblclick', e => {
            e.preventDefault();
            zmZoomTo(zm.s > 1.05 ? 1 : ZM_DBL, e.clientX, e.clientY, true);
        });

        // 桌面滚轮：以光标为焦点缩放（灯箱打开时页面滚动已锁）
        lightbox.addEventListener('wheel', e => {
            e.preventDefault();
            zmZoomTo(zm.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY, false);
        }, { passive: false });

        // 桌面拖拽平移（缩放态）
        let mousePan = null;
        lightboxImg.addEventListener('mousedown', e => {
            if (zm.s <= 1) return;
            e.preventDefault();
            mousePan = { x: e.clientX, y: e.clientY, tx: zm.tx, ty: zm.ty };
        });
        document.addEventListener('mousemove', e => {
            if (!mousePan) return;
            zm.tx = mousePan.tx + (e.clientX - mousePan.x);
            zm.ty = mousePan.ty + (e.clientY - mousePan.y);
            zmClampPan();
            zmApply(false);
        });
        document.addEventListener('mouseup', () => { mousePan = null; });

        // 触摸：单指（1x=切换滑动 / >1x=平移）、双指捏合缩放、双击缩放
        let pinch = null;  // { d0, s0, tx, ty }
        let panOne = null; // { x, y, tx, ty }
        let lastTap = 0, lastTapX = 0, lastTapY = 0;

        lightbox.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                e.preventDefault(); // 阻止浏览器页面级捏合
                const a = e.touches[0], b = e.touches[1];
                pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s0: zm.s, tx: zm.tx, ty: zm.ty };
                touchStartX = null;
                panOne = null;
            } else if (e.touches.length === 1) {
                if (zm.s > 1) {
                    panOne = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: zm.tx, ty: zm.ty };
                    touchStartX = null;
                } else {
                    touchStartX = e.touches[0].clientX;
                }
            }
        }, { passive: false });

        lightbox.addEventListener('touchmove', e => {
            if (e.touches.length === 2 && pinch) {
                e.preventDefault();
                const a = e.touches[0], b = e.touches[1];
                const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                // 先回到捏合起点，再以当前双指中心为焦点按相对比例缩放
                zm.s = pinch.s0; zm.tx = pinch.tx; zm.ty = pinch.ty;
                zmZoomTo(pinch.s0 * d / pinch.d0, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, false);
            } else if (e.touches.length === 1 && panOne) {
                e.preventDefault();
                zm.tx = panOne.tx + (e.touches[0].clientX - panOne.x);
                zm.ty = panOne.ty + (e.touches[0].clientY - panOne.y);
                zmClampPan();
                zmApply(false);
            }
        }, { passive: false });

        lightbox.addEventListener('touchend', e => {
            if (e.touches.length === 2) return;
            if (e.touches.length === 1) {
                // 双指抬起剩一指：缩放态平滑转入单指平移
                pinch = null;
                if (zm.s > 1) panOne = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: zm.tx, ty: zm.ty };
                return;
            }
            const wasPan = !!panOne;
            pinch = null;
            panOne = null;
            // 单指抬起且未平移：双击判定（300ms 内、位移 <24px）
            if (!wasPan) {
                const now = Date.now();
                const t = e.changedTouches[0];
                if (now - lastTap < 300 && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 24) {
                    zmZoomTo(zm.s > 1.05 ? 1 : ZM_DBL, t.clientX, t.clientY, true);
                    lastTap = 0;
                    touchStartX = null;
                    return;
                }
                lastTap = now; lastTapX = t.clientX; lastTapY = t.clientY;
            }
            // 原有单指滑动切换（仅 1x 态，缩放态 touchStartX 始终为 null 不会触发）
            if (touchStartX === null) return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            touchStartX = null;
            if (Math.abs(dx) > 40) (dx < 0 ? next : prev)();
        }, { passive: true });
    }

    /* ---------- 写真集列表 ---------- */

    let gallerySearchQuery = '';
    let galleryYearFilter = '';
    let galleryMonthFilter = '';

    /** 日期展示：YYYY-MM-DD → YYYY.MM.DD（站内日期风格），无日期返回空 */
    const fmtAlbumDate = d => String(d || '').replace(/-/g, '.');

    /** 时间筛选数据：年份降序；月份降序（选年=该年月份，全部=跨年月份并集） */
    function filterYears() {
        const years = new Set();
        albums.forEach(a => { if (/^\d{4}-/.test(String(a.date || ''))) years.add(String(a.date).slice(0, 4)); });
        return [...years].sort().reverse();
    }
    function filterMonths(year) {
        const months = new Set();
        albums.forEach(a => {
            const d = String(a.date || '');
            if (!/^\d{4}-\d{2}/.test(d)) return;
            if (!year || d.slice(0, 4) === String(year)) months.add(d.slice(5, 7));
        });
        return [...months].sort().reverse();
    }

    /** 排序：基准=原有「新增在前」（数组倒序）；有日期的按日期降序提到前面，无日期垫底（保持新增在前次序） */
    function sortAlbumEntries(entries) {
        return entries.slice().reverse().sort((x, y) => {
            const dx = String(x.a.date || ''), dy = String(y.a.date || '');
            if (dx && dy && dx !== dy) return dx < dy ? 1 : -1;
            if (dx !== dy) return dx ? -1 : 1;
            return 0; // 同日期/同无日期：保持「新增在前」基准序（稳定排序）
        });
    }

    /** 详情页分享入口：复制链接（不生成海报） */
    function bindShareButton(btn) {
        if (!btn) return;
        btn.addEventListener('click', () => {
            window.CMS.copyToClipboard(window.location.href).then(ok => {
                const original = btn.innerHTML;
                btn.innerHTML = ok ? T('common.copied', '已复制 ✓') : T('common.copyFailed', '复制失败');
                setTimeout(() => { btn.innerHTML = original; }, 1800);
            });
        });
    }

    /** 滚动显现：元素进入视口时补 .is-visible（带 stagger 错开），无 IO 则立即显示。
        之前是「渲染后同步全部加 is-visible」——初始态与揭示态同帧，过渡被跳过，卡片直接出现无动画。
        append=true 时复用现有 observer（分批渲染追加卡片，不重连已观察的旧元素）。 */
    let revealIO = null; // 单例：搜索/筛选反复重渲染时复用，避免 observer 泄漏
    function revealOnScroll(elements, stagger = 60, append = false) {
        const list = Array.from(elements);
        if (!list.length) return;
        // 非追加（列表整体重绘）：断开上一批的观察，旧元素不再需要
        if (!append && revealIO) { revealIO.disconnect(); revealIO = null; }
        if (typeof window.IntersectionObserver === 'undefined') {
            list.forEach(el => el.classList.add('is-visible'));
            return;
        }
        if (!revealIO) {
            revealIO = new IntersectionObserver(entries => {
                let i = 0;
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const el = entry.target;
                    // 同批进入视口的按序错开，形成瀑布式浮现
                    el.style.setProperty('--stagger', (i * stagger) + 'ms');
                    i++;
                    el.classList.add('is-visible');
                    revealIO.unobserve(el);
                });
            }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
        }
        list.forEach(el => revealIO.observe(el));
    }

    /* ---------- 列表分批渲染 ----------
     * 图集可达数百个：一次性 innerHTML 会同步创建同等数量的 DOM 节点 + 触发整页布局，
     * 在移动端是明显的初始化卡顿与滚动掉帧。改为「首批 + 触底追加」：
     * 每批 LIST_BATCH 个，哨兵进入视口（提前 LIST_PREFETCH 像素）再渲染下一批。
     * 筛选/搜索变化时整体重来（重置为第一批）。 */
    const LIST_BATCH = 60;
    const LIST_PREFETCH = '600px 0px';
    let listState = null;   // { shown, box, sentinel, rendered }
    let listIO = null;      // 分页哨兵观察器

    /** 单张卡片 HTML（与旧实现逐字一致，抽出以便分批复用） */
    function albumCardHtml(entry) {
        const album = entry.a, ai = entry.idx;
        const cover = safeUrl(album.cover || (album.images && album.images[0]), 'image');
        const dateTxt = fmtAlbumDate(album.date);
        return `
            <a class="album-card" href="/gallery.html?album=${album.id || ai}">
                <div class="album-card__cover">
                    <img src="${cover}" alt="${esc(pick(album, 'title') || T('gallery.albumFallback', '写真集'))}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')">
                </div>
                <div class="album-card__body">
                    <h2 class="album-card__title">${esc(pick(album, 'title') || (T('gallery.albumFallback', '写真集') + ' ' + (ai + 1)))}</h2>
                    ${album.author ? `<span class="album-card__author">${esc(T('gallery.authorPrefix', '作者：'))}${esc(album.author)}</span>` : ''}
                    <span class="album-card__count">${[(album.images || []).length + T('unit.photo', ' 张'), dateTxt].filter(Boolean).join(' · ')}</span>
                </div>
            </a>`;
    }

    function teardownListScroll() {
        if (listIO) { listIO.disconnect(); listIO = null; }
        if (listState && listState.sentinel) {
            listState.sentinel.remove();
            listState.sentinel = null;
        }
    }

    /** 追加下一批；若仍有剩余则在末尾放哨兵等待触底 */
    function appendListBatch() {
        if (!listState) return;
        const { shown, box } = listState;
        const start = listState.rendered;
        const end = Math.min(start + LIST_BATCH, shown.length);
        if (start >= end) return;

        const tmp = document.createElement('div');
        tmp.innerHTML = shown.slice(start, end).map(albumCardHtml).join('');
        const cards = Array.from(tmp.children);
        cards.forEach(el => box.appendChild(el));
        listState.rendered = end;
        revealOnScroll(cards, 60, true);   // 追加观察，不打断已观察的旧卡片

        if (listState.sentinel) { listState.sentinel.remove(); listState.sentinel = null; }
        if (end < shown.length) {
            const s = document.createElement('div');
            s.className = 'gallery-list-sentinel';
            s.setAttribute('aria-hidden', 'true');
            grid.appendChild(s);
            listState.sentinel = s;
            if (typeof window.IntersectionObserver === 'undefined') {
                appendListBatch();                 // 无 IO：降级为一次性补齐
            } else {
                if (!listIO) {
                    listIO = new IntersectionObserver(entries => {
                        if (entries.some(e => e.isIntersecting)) appendListBatch();
                    }, { rootMargin: LIST_PREFETCH });
                }
                listIO.observe(s);
                // 哨兵若已落在视口内（首屏高、或筛选后页面仍处于滚动位置），
                // IO 的首次回调要等下一帧；这里主动补一批，避免出现"看着有空白却要再滚一下"的顿挫。
                requestAnimationFrame(() => {
                    if (!listState || listState.sentinel !== s) return;   // 期间已重绘
                    const r = s.getBoundingClientRect();
                    const vh = window.innerHeight || 0;
                    if (r.top < vh + 600 && r.bottom > -600) appendListBatch();
                });
            }
        }
    }

    function renderAlbumCards() {
        const q = gallerySearchQuery.trim().toLowerCase();
        const match = a => !q || [a.title, a.author].some(f => String(f || '').toLowerCase().includes(q));
        // 保留原索引：卡片链接 ?album= 的数字兜底必须是 gallery.albums 的真实下标（排序/筛选后仍不变）
        let shown = albums.map((a, idx) => ({ a, idx })).filter(x => match(x.a));
        if (galleryYearFilter) shown = shown.filter(x => String(x.a.date || '').slice(0, 4) === galleryYearFilter);
        if (galleryMonthFilter) shown = shown.filter(x => String(x.a.date || '').slice(5, 7) === galleryMonthFilter);
        shown = sortAlbumEntries(shown);

        const countEl = document.getElementById('gallery-search-count');
        if (countEl) countEl.textContent = (q || galleryYearFilter || galleryMonthFilter) ? (shown.length + ' / ' + albums.length + T('gallery.countUnit', ' 个写真集')) : '';

        teardownListScroll();   // 重绘前清掉上一轮的分页哨兵与观察器

        if (q && !shown.length) {
            grid.innerHTML = `<p class="gallery-page__empty">${esc(T('gallery.emptySearch', '未找到匹配的写真集'))}</p>`;
            return;
        }
        if ((galleryYearFilter || galleryMonthFilter) && !shown.length) {
            grid.innerHTML = `<p class="gallery-page__empty">${esc(T('gallery.emptyTime', '这个时间段还没有写真集'))}</p>`;
            return;
        }
        if (!albums.length) {
            grid.innerHTML = `<p class="gallery-page__empty">${esc(T('gallery.emptyDefault', '暂无写真集'))}</p>`;
            return;
        }

        grid.innerHTML = '<div class="gallery__albums"></div>';
        listState = { shown, box: grid.querySelector('.gallery__albums'), sentinel: null, rendered: 0 };
        // 列表整体重绘：重置显现观察器（旧卡片已随 innerHTML 移除）
        if (revealIO) { revealIO.disconnect(); revealIO = null; }
        appendListBatch();
    }

    /** 筛选行渲染（只重绘筛选容器，不动搜索框）；样式与 works-filter 文本筛选同语言 */
    function filterRowHtml(items, active, rowCls) {
        // ⚠️ 两行只用各自的属性：年份行 data-year、月份行 data-month。
        // 早期版本两个属性同时写在每个按钮上，导致「选月份」时按 data-month 批量切 active
        // 会连带命中年份按钮（data-month=""）而清掉年份下划线（同型判断要改净）。
        const attr = rowCls ? 'data-month' : 'data-year';
        return `
            <div class="gallery-filter__row${rowCls ? ' ' + rowCls : ''}">
                <button type="button" class="gallery-filter__link${active === '' ? ' active' : ''}" ${attr}="">${esc(T('common.all', '全部'))}</button>
                ${items.map(v => `<button type="button" class="gallery-filter__link${active === v ? ' active' : ''}" ${attr}="${v}">${rowCls ? parseInt(v, 10) + T('unit.monthSuffix', '月') : v}</button>`).join('')}
            </div>`;
    }

    function renderFilterRows() {
        const box = document.getElementById('gallery-filter');
        if (!box) return;
        const years = filterYears();
        if (!years.length) { box.innerHTML = ''; return; }
        // 两层常驻：年份行 + 月份行（「全部」年份下月份为跨年并集）
        box.innerHTML = filterRowHtml(years, galleryYearFilter, '') + filterRowHtml(filterMonths(galleryYearFilter), galleryMonthFilter, 'gallery-filter__row--month');
    }

    function renderList() {
        masonryItemsData = null;
        masonryState = null;
        if (top) {
            top.innerHTML = `
                <p class="gallery-page__eyebrow">GALLERY</p>
                <h1 class="gallery-page__title">${esc(pick(gallery, 'heading') || T('gallery.title', '写真'))}</h1>
                <p class="gallery-page__desc">${esc(T('gallery.count', '共 {n} 个写真集', { n: albums.length }))}</p>
                <div class="page-search">
                    <input type="search" id="gallery-search-input" placeholder="${esc(T('gallery.searchPlaceholder', '搜索写真集标题 / 作者…'))}" autocomplete="off">
                    <span class="page-search__count" id="gallery-search-count"></span>
                </div>
                <div class="gallery-filter" id="gallery-filter"></div>
            `;
            renderFilterRows();
            const box = document.getElementById('gallery-filter');
            box.addEventListener('click', e => {
                const btn = e.target.closest('.gallery-filter__link');
                if (!btn) return;
                const row = btn.closest('.gallery-filter__row');
                const isMonthRow = !!(row && row.classList.contains('gallery-filter__row--month'));
                if (isMonthRow) {
                    // 月份：只切本行 active，不影响年份行；「全部」仅清月份
                    const v = btn.dataset.month || '';
                    galleryMonthFilter = (galleryMonthFilter === v) ? '' : v;
                    if (row) {
                        Array.prototype.forEach.call(row.querySelectorAll('[data-month]'),
                            b => b.classList.toggle('active', (b.dataset.month || '') === galleryMonthFilter));
                    }
                } else {
                    // 年份（含年份行「全部」）：切换年份并重置月份，月份行随之重绘
                    const v = btn.dataset.year || '';
                    galleryYearFilter = (galleryYearFilter === v) ? '' : v;
                    galleryMonthFilter = '';
                    renderFilterRows();
                }
                renderAlbumCards();
            });
        }
        renderAlbumCards();
        const input = document.getElementById('gallery-search-input');
        if (input) {
            input.addEventListener('input', () => {
                gallerySearchQuery = input.value;
                renderAlbumCards();
            });
        }
    }

    /* ---------- 瀑布流：先量后排 + 追加式分栏 ----------
       CSS 多栏在图片高度未知时，每次加载完成都会全局再平衡（条目在栏间搬家）。
       这里先测量宽高比、给条目写死 aspect-ratio，再按最短栏"只追加不移动"——
       已落位内容永不改变位置，加载期零跳动。尺寸存 sessionStorage，同会话秒开。 */

    const DIMS_CACHE_KEY = 'masonry-dims-v1';
    const MASONRY_MAX_PARALLEL = 6;
    const MASONRY_TIMEOUT = 8000;
    let masonryState = null;
    let masonryItemsData = null;
    let masonryGeneration = 0;
    let masonryResizeTimer = null;

    function readDimsCache() {
        try { return JSON.parse(sessionStorage.getItem(DIMS_CACHE_KEY) || '{}'); } catch (e) { return {}; }
    }

    function writeDimsCache(cache) {
        try { sessionStorage.setItem(DIMS_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* 隐私模式等场景静默失败 */ }
    }

    function masonryCols() {
        // 移动端同样 2 栏：单列浏览效率低、滚动距离过长（双列是小红书/花瓣式主流）
        return window.innerWidth > 900 ? 3 : 2;
    }

    function masonryItemHtml(it) {
        return `<figure class="gallery__item has-ratio" style="aspect-ratio:${it.ratio}">
            <img src="${safeUrl(it.url, 'image')}" alt="${esc(it.alt)}" loading="lazy" decoding="async" onerror="this.style.display='none'">
        </figure>`;
    }

    function masonryAppendInto(state, it) {
        const ci = state.heights.indexOf(Math.min.apply(null, state.heights));
        const holder = document.createElement('div');
        holder.innerHTML = masonryItemHtml(it);
        const fig = holder.firstElementChild;
        it._el = fig; // 供尺寸修正时定位
        state.colEls[ci].appendChild(fig);
        // 下一帧再揭示：让 opacity 过渡（显现淡入）真实播放
        requestAnimationFrame(() => fig.classList.add('is-visible'));
        // 栏高估算必须用 h/w（1/ratio）：it.ratio 存的是宽高比 w/h，
        // 直接累加会把横图估"高"、竖图估"矮"，分栏平衡完全反转（一列爆满一列空白的根因）；
        // 栏宽一致，h/w 即相对高度；0.12 为条目间距估算
        state.heights[ci] += (it.ratio ? 1 / it.ratio : 4 / 3) + 0.12;
    }

    function masonryStatus(text) {
        const el = document.getElementById('masonryStatus');
        if (el) {
            el.textContent = text || '';
            el.style.display = text ? '' : 'none';
        }
    }

    /** 先插入后测：用占位比例立即布局（首屏秒出），图片加载后按真实比例修正该条目。
        相比「全部测完再插入」，避免了数百张图串行测量造成的长时间空白与卡顿。 */
    function renderMasonry(items) {
        const gen = ++masonryGeneration;
        masonryItemsData = items;
        const cols = masonryCols();
        grid.innerHTML = `
            <p class="masonry-status" id="masonryStatus" style="display:none"></p>
            <div class="album-masonry">${Array.from({ length: cols }, () => '<div class="album-masonry__col"></div>').join('')}</div>
        `;
        const state = {
            cols,
            colEls: Array.from(grid.querySelectorAll('.album-masonry__col')),
            heights: new Array(cols).fill(0)
        };
        masonryState = state;

        const cache = readDimsCache();
        // 有缓存比例的直接用；无缓存的先用占位比例 3/4 插入，加载后修正
        const pending = [];
        items.forEach(it => {
            const c = cache[it.url];
            if (c && c[0] > 0 && c[1] > 0) it.ratio = c[0] / c[1];
            else {
                it.ratio = 3 / 4;      // 占位：立即参与布局
                it.pendingRatio = true; // 标记待修正
                pending.push(it);
            }
        });

        // 立即全量插入（首屏即可见，无需等待任何测量）
        for (const it of items) {
            masonryAppendInto(state, it);
        }
        masonryStatus('');

        // 后台修正：并发探测真实尺寸，只改自己那条的 aspect-ratio（不搬动其他条目）
        let active = 0, qi = 0;
        function pump() {
            if (gen !== masonryGeneration) return;
            while (active < MASONRY_MAX_PARALLEL && qi < pending.length) {
                const it = pending[qi++];
                active++;
                const im = new Image();
                const done = (w, h, failed) => {
                    if (gen !== masonryGeneration || !it.pendingRatio) return;
                    active--;
                    it.pendingRatio = false;
                    if (failed || !(w > 0 && h > 0)) return; // 失败保持占位比例，不阻塞
                    const ratio = w / h;
                    it.ratio = ratio;
                    cache[it.url] = [w, h];
                    writeDimsCache(cache);
                    // 只更新该条目的 aspect-ratio（高度随之变化，但不触发其他条目重排）
                    const el = it._el;
                    if (el) el.style.aspectRatio = String(ratio);
                    pump();
                };
                im.onload = () => done(im.naturalWidth, im.naturalHeight, false);
                im.onerror = () => done(0, 0, true);
                setTimeout(() => { if (it.pendingRatio) done(0, 0, true); }, MASONRY_TIMEOUT);
                im.src = it.url;
            }
        }
        pump();
    }

    // 断点跨越时用已测尺寸瞬时重分布（图片走缓存，无重复下载）
    window.addEventListener('resize', () => {
        if (!masonryItemsData) return;
        clearTimeout(masonryResizeTimer);
        masonryResizeTimer = setTimeout(() => {
            if (masonryState && masonryState.cols !== masonryCols()) renderMasonry(masonryItemsData);
        }, 200);
    });

    /* ---------- 写真集详情 ---------- */

    function renderAlbum(album, ai) {
        const images = album.images || [];
        const source = safeUrl(album.sourceUrl, 'link');
        if (top) {
            top.innerHTML = `
                <div class="album-detail__head">
                    <a class="hover-underline" href="/gallery.html">${esc(T('gallery.back', '← 返回写真集'))}</a>
                    <h1 class="album-detail__title">${esc(pick(album, 'title') || (T('gallery.albumFallback', '写真集') + ' ' + (ai + 1)))}</h1>
                    <span class="album-detail__count">${[(images.length + T('unit.photo', ' 张')), fmtAlbumDate(album.date)].filter(Boolean).join(' · ')}</span>
                    <button type="button" class="album-detail__share" id="albumShare" aria-label="${esc(T('common.copyLink', '复制链接'))}" title="${esc(T('common.copyLink', '复制链接'))}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.4 13.3l7.2 4.2M15.6 6.5L8.4 10.7"/></svg>
                    </button>
                </div>
                ${(album.author || source) ? `
                    <div class="album-detail__meta">
                        ${album.author ? `<span class="album-detail__author">${esc(T('gallery.authorPrefix', '作者：'))}${esc(album.author)}</span>` : ''}
                        ${source ? `<a class="album-detail__source" href="${source}" target="_blank" rel="noopener">${esc(T('common.viewOriginal', '查看原始链接 ↗'))}</a>` : ''}
                    </div>
                ` : ''}
            `;
        }
        bindShareButton(document.getElementById('albumShare'));

        if (!images.length) {
            grid.innerHTML = `<p class="gallery-page__empty">${esc(T('gallery.emptyAlbum', '这个写真集还没有照片'))}</p>`;
            curImages = [];
            return;
        }

        curImages = images.filter(Boolean);
        renderMasonry(images.map((url, i) => ({ url, alt: T('gallery.altPhoto', '写真 {n}', { n: i + 1 }) })));
        if (window.Comments && album.id) window.Comments.render('album-' + album.id, grid, 'afterend');
    }

    /* ---------- 作品图集兼容 ---------- */

    function renderWorkGallery() {
        let work = null;
        if (workRef !== null) {
            for (const cat of categories) {
                const hit = (cat.items || []).find(x => x.id && x.id === workRef);
                if (hit) { work = hit; break; }
            }
        }
        if (!work && catIndex !== null && categories[catIndex] && categories[catIndex].items && categories[catIndex].items[workIndex]) {
            work = categories[catIndex].items[workIndex];
        }
        if (!work && workIndex !== null && categories.length && categories[0] && categories[0].items && categories[0].items[workIndex]) {
            work = categories[0].items[workIndex];
        }
        const images = (work && Array.isArray(work.images) ? work.images : []).filter((url, i, arr) => arr.indexOf(url) === i);
        const catName = catIndex !== null && categories[catIndex] ? categories[catIndex].name : '';
        const metaParts = [];
        if (catName) metaParts.push(catName);
        if (work && work.type && work.type !== catName) metaParts.push(work.type);
        if (work && work.year) metaParts.push(work.year);
        if (work && work.director) metaParts.push(work.director);
        const source = work ? safeUrl(work.sourceUrl, 'link') : '';

        if (top) {
            top.innerHTML = `
                <div class="album-detail__head">
                    <a class="hover-underline" href="/works.html">${esc(T('workGallery.back', '← 返回作品'))}</a>
                    <h1 class="album-detail__title">${esc(work ? pick(work, 'title') : T('workGallery.fallback', '作品图集'))}</h1>
                    <span class="album-detail__count">${images.length}${esc(T('unit.photo', ' 张'))}</span>
                    <button type="button" class="album-detail__share" id="workShare" aria-label="${esc(T('common.copyLink', '复制链接'))}" title="${esc(T('common.copyLink', '复制链接'))}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.4 13.3l7.2 4.2M15.6 6.5L8.4 10.7"/></svg>
                    </button>
                </div>
                ${work ? `
                    <div class="work-detail">
                        <p class="work-detail__meta">
                            ${esc(metaParts.join(' · '))}
                        </p>
                        <p class="work-detail__role">${esc(T('works.rolePrefix', '饰演 '))}${esc(work.role || '')}</p>
                        <p class="work-detail__synopsis">${esc(work.synopsis || '')}</p>
                        ${source ? `<p class="work-detail__source"><a class="album-detail__source" href="${source}" target="_blank" rel="noopener">${esc(T('common.viewOriginal', '查看原始链接 ↗'))}</a></p>` : ''}
                    </div>
                ` : ''}
            `;
        }
        bindShareButton(document.getElementById('workShare'));

        if (!images.length) {
            grid.innerHTML = `<p class="gallery-page__empty">${esc(T('workGallery.empty', '这个作品还没有剧照'))}</p>`;
            curImages = [];
            return;
        }

        curImages = images.filter(Boolean);
        renderMasonry(images.map((url, i) => ({ url, alt: T('workGallery.altStill', '剧照 {n}', { n: i + 1 }) })));
        if (window.Comments && work && work.id) window.Comments.render('work-' + work.id, grid, 'afterend');
    }

    /* ---------- 入口 ---------- */

    // 先确保图集数据就绪（data-gallery.js 懒加载；已内联引入则立即 resolve）
    const ready = (window.CMS && window.CMS.loadGallery) ? window.CMS.loadGallery() : Promise.resolve();
    ready.then(() => {
        refreshGalleryData();

        const resolvedAlbum = albumRef !== null ? resolveAlbum(albumRef) : { album: null, ai: NaN };
        if (resolvedAlbum.album) {
            renderAlbum(resolvedAlbum.album, resolvedAlbum.ai);
        } else if (catIndex !== null || workRef !== null) {
            renderWorkGallery();
        } else {
            renderList();   // 列表页的分批渲染与滚动显现都在其内部完成
        }
    });

    bindLightbox();
    setupNav();
})();
