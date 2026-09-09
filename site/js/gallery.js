(function () {
    'use strict';

    const C = SITE_CONFIG;
    const U = window.CMS.utils;
    const esc = U.esc;
    const safeUrl = U.safeUrl;

    const top = document.getElementById('galleryTop');
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    const params = new URLSearchParams(window.location.search);
    const albumRef = params.get('album');
    const catIndex = params.get('cat');
    const workRef = params.get('work');
    // 老链接兜底：无稳定 ID 的老作品走 ?cat=N&work=M 数字索引（page.js 仍会生成该格式），缺此解析会 ReferenceError 整页崩
    const workIndex = workRef !== null && /^\d+$/.test(workRef) ? parseInt(workRef, 10) : null;

    const gallery = C.gallery || { heading: '写真', albums: [] };
    const albums = Array.isArray(gallery.albums) ? gallery.albums : [];

    /** 解析相册：优先稳定 ID，数字参数按索引兜底（老链接兼容） */
    function resolveAlbum(ref) {
        let ai = albums.findIndex(a => a.id && a.id === ref);
        if (ai < 0 && /^\d+$/.test(String(ref))) ai = parseInt(ref, 10);
        return { album: albums[ai] || null, ai };
    }
    const works = C.works || {};
    const categories = Array.isArray(works.categories) && works.categories.length
        ? works.categories
        : (works.items || []).length ? [{ name: '代表作品', items: works.items }] : [];

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
            if (e.target === lightbox || e.target === lightboxImg) close();
        });

        document.addEventListener('keydown', e => {
            if (lightbox.style.display === 'none') return;
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowLeft') prev();
            if (e.key === 'ArrowRight') next();
        });

        // 触摸滑动切换
        lightbox.addEventListener('touchstart', e => {
            if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
        }, { passive: true });
        lightbox.addEventListener('touchend', e => {
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
                btn.innerHTML = ok ? '已复制 ✓' : '复制失败';
                setTimeout(() => { btn.innerHTML = original; }, 1800);
            });
        });
    }

    /** 滚动显现：元素进入视口时补 .is-visible（带 stagger 错开），无 IO 则立即显示。
        之前是「渲染后同步全部加 is-visible」——初始态与揭示态同帧，过渡被跳过，卡片直接出现无动画。 */
    let revealIO = null; // 单例：搜索/筛选反复重渲染时复用，避免 observer 泄漏
    function revealOnScroll(elements, stagger = 60) {
        const list = Array.from(elements);
        if (!list.length) return;
        // 断开上一批的观察（列表已重渲染，旧元素不再需要）
        if (revealIO) { revealIO.disconnect(); revealIO = null; }
        if (typeof window.IntersectionObserver === 'undefined') {
            list.forEach(el => el.classList.add('is-visible'));
            return;
        }
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
        list.forEach(el => revealIO.observe(el));
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
        if (countEl) countEl.textContent = (q || galleryYearFilter || galleryMonthFilter) ? (shown.length + ' / ' + albums.length + ' 个写真集') : '';

        if (q && !shown.length) {
            grid.innerHTML = '<p class="gallery-page__empty">未找到匹配的写真集</p>';
            return;
        }
        if ((galleryYearFilter || galleryMonthFilter) && !shown.length) {
            grid.innerHTML = '<p class="gallery-page__empty">这个时间段还没有写真集</p>';
            return;
        }
        if (!albums.length) {
            grid.innerHTML = '<p class="gallery-page__empty">暂无写真集</p>';
            return;
        }
        grid.innerHTML = `
            <div class="gallery__albums">
                ${shown.map(({ a: album, idx: ai }) => {
                    const cover = safeUrl(album.cover || (album.images && album.images[0]), 'image');
                    const dateTxt = fmtAlbumDate(album.date);
                    return `
                        <a class="album-card" href="/gallery.html?album=${album.id || ai}">
                            <div class="album-card__cover">
                                <img src="${cover}" alt="${esc(album.title || '写真集')}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')">
                            </div>
                            <div class="album-card__body">
                                <h2 class="album-card__title">${esc(album.title || ('写真集 ' + (ai + 1)))}</h2>
                                ${album.author ? `<span class="album-card__author">作者：${esc(album.author)}</span>` : ''}
                                <span class="album-card__count">${[(album.images || []).length + ' 张', dateTxt].filter(Boolean).join(' · ')}</span>
                            </div>
                        </a>
                    `;
                }).join('')}
            </div>
        `;
        // 卡片初始隐藏（opacity:0），进入视口时滚动显现（搜索/筛选重渲染的卡片同样走这条路径）
        revealOnScroll(grid.querySelectorAll('.album-card'));
    }

    /** 筛选行渲染（只重绘筛选容器，不动搜索框）；样式与 works-filter 文本筛选同语言 */
    function filterRowHtml(items, active, rowCls) {
        return `
            <div class="gallery-filter__row${rowCls ? ' ' + rowCls : ''}">
                <button type="button" class="gallery-filter__link${active === '' ? ' active' : ''}" data-year="" data-month="">全部</button>
                ${items.map(v => `<button type="button" class="gallery-filter__link${active === v ? ' active' : ''}" data-year="${rowCls ? '' : v}" data-month="${rowCls ? v : ''}">${rowCls ? parseInt(v, 10) + '月' : v}</button>`).join('')}
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
                <h1 class="gallery-page__title">${esc(gallery.heading || '写真')}</h1>
                <p class="gallery-page__desc">共 ${albums.length} 个写真集</p>
                <div class="page-search">
                    <input type="search" id="gallery-search-input" placeholder="搜索写真集标题 / 作者…" autocomplete="off">
                    <span class="page-search__count" id="gallery-search-count"></span>
                </div>
                <div class="gallery-filter" id="gallery-filter"></div>
            `;
            renderFilterRows();
            const box = document.getElementById('gallery-filter');
            box.addEventListener('click', e => {
                const btn = e.target.closest('[data-year]');
                if (!btn) return;
                if (btn.dataset.year) {
                    // 年份：切换后月份行随该年数据重绘，月份重置
                    galleryYearFilter = galleryYearFilter === btn.dataset.year ? '' : btn.dataset.year;
                    galleryMonthFilter = '';
                    renderFilterRows();
                } else if (btn.dataset.month) {
                    galleryMonthFilter = galleryMonthFilter === btn.dataset.month ? '' : btn.dataset.month;
                    Array.prototype.forEach.call(box.querySelectorAll('[data-month]'), b => b.classList.toggle('active', (b.dataset.month || '') === galleryMonthFilter));
                } else {
                    // 年份行「全部」
                    galleryYearFilter = '';
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
        const w = window.innerWidth;
        return w > 900 ? 3 : (w > 640 ? 2 : 1);
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
        // 栏宽一致，比例即相对高度；0.12 为条目间距估算
        state.heights[ci] += (it.ratio || 0.75) + 0.12;
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
        let placed = 0;
        for (const it of items) {
            masonryAppendInto(state, it);
            placed++;
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
                    <a class="hover-underline" href="/gallery.html">← 返回写真集</a>
                    <h1 class="album-detail__title">${esc(album.title || ('写真集 ' + (ai + 1)))}</h1>
                    <span class="album-detail__count">${[(images.length + ' 张'), fmtAlbumDate(album.date)].filter(Boolean).join(' · ')}</span>
                    <button type="button" class="album-detail__share" id="albumShare" aria-label="复制链接" title="复制链接">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.4 13.3l7.2 4.2M15.6 6.5L8.4 10.7"/></svg>
                    </button>
                </div>
                ${(album.author || source) ? `
                    <div class="album-detail__meta">
                        ${album.author ? `<span class="album-detail__author">作者：${esc(album.author)}</span>` : ''}
                        ${source ? `<a class="album-detail__source" href="${source}" target="_blank" rel="noopener">查看原始链接 ↗</a>` : ''}
                    </div>
                ` : ''}
            `;
        }
        bindShareButton(document.getElementById('albumShare'));

        if (!images.length) {
            grid.innerHTML = '<p class="gallery-page__empty">这个写真集还没有照片</p>';
            curImages = [];
            return;
        }

        curImages = images.filter(Boolean);
        renderMasonry(images.map((url, i) => ({ url, alt: `写真 ${i + 1}` })));
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
                    <a class="hover-underline" href="/works.html">← 返回作品</a>
                    <h1 class="album-detail__title">${esc(work ? work.title : '作品图集')}</h1>
                    <span class="album-detail__count">${images.length} 张</span>
                    <button type="button" class="album-detail__share" id="workShare" aria-label="复制链接" title="复制链接">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.4 13.3l7.2 4.2M15.6 6.5L8.4 10.7"/></svg>
                    </button>
                </div>
                ${work ? `
                    <div class="work-detail">
                        <p class="work-detail__meta">
                            ${esc(metaParts.join(' · '))}
                        </p>
                        <p class="work-detail__role">饰演 ${esc(work.role || '')}</p>
                        <p class="work-detail__synopsis">${esc(work.synopsis || '')}</p>
                        ${source ? `<p class="work-detail__source"><a class="album-detail__source" href="${source}" target="_blank" rel="noopener">查看原始链接 ↗</a></p>` : ''}
                    </div>
                ` : ''}
            `;
        }
        bindShareButton(document.getElementById('workShare'));

        if (!images.length) {
            grid.innerHTML = '<p class="gallery-page__empty">这个作品还没有剧照</p>';
            curImages = [];
            return;
        }

        curImages = images.filter(Boolean);
        renderMasonry(images.map((url, i) => ({ url, alt: `剧照 ${i + 1}` })));
        if (window.Comments && work && work.id) window.Comments.render('work-' + work.id, grid, 'afterend');
    }

    /* ---------- 入口 ---------- */

    const resolvedAlbum = albumRef !== null ? resolveAlbum(albumRef) : { album: null, ai: NaN };
    if (resolvedAlbum.album) {
        renderAlbum(resolvedAlbum.album, resolvedAlbum.ai);
    } else if (catIndex !== null || workRef !== null) {
        renderWorkGallery();
    } else {
        renderList();
    }

    // 列表页卡片走滚动显现；瀑布流条目由 masonryAppendInto 逐条揭示（见上）
    revealOnScroll(grid.querySelectorAll('.album-card'));

    bindLightbox();
    setupNav();
})();
