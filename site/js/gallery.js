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
    const albumIndex = params.get('album');
    const catIndex = params.get('cat');
    const workIndex = params.get('work');

    const gallery = C.gallery || { heading: '写真', albums: [] };
    const albums = Array.isArray(gallery.albums) ? gallery.albums : [];
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

    function renderAlbumCards() {
        const q = gallerySearchQuery.trim().toLowerCase();
        const match = a => !q || [a.title, a.author].some(f => String(f || '').toLowerCase().includes(q));
        // 新增的在前，保留原索引：卡片链接 ?album= 必须是 gallery.albums 的真实下标
        const shown = albums.map((a, idx) => ({ a, idx })).reverse().filter(x => match(x.a));

        const countEl = document.getElementById('gallery-search-count');
        if (countEl) countEl.textContent = q ? (shown.length + ' / ' + albums.length + ' 个写真集') : '';

        if (q && !shown.length) {
            grid.innerHTML = '<p class="gallery-page__empty">未找到匹配的写真集</p>';
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
                    return `
                        <a class="album-card" href="/gallery.html?album=${ai}">
                            <div class="album-card__cover">
                                <img src="${cover}" alt="${esc(album.title || '写真集')}" loading="lazy" onerror="this.parentElement.classList.add('is-empty')">
                            </div>
                            <div class="album-card__body">
                                <h2 class="album-card__title">${esc(album.title || ('写真集 ' + (ai + 1)))}</h2>
                                ${album.author ? `<span class="album-card__author">作者：${esc(album.author)}</span>` : ''}
                                <span class="album-card__count">${(album.images || []).length} 张</span>
                            </div>
                        </a>
                    `;
                }).join('')}
            </div>
        `;
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
            `;
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
        const queue = [];
        items.forEach(it => {
            const c = cache[it.url];
            if (c && c[0] > 0 && c[1] > 0) it.ratio = c[0] / c[1];
            else queue.push(it);
        });

        let nextToPlace = 0;
        let remaining = queue.length;
        let placed = 0;

        function flush() {
            if (gen !== masonryGeneration) return;
            while (nextToPlace < items.length && items[nextToPlace].ratio !== undefined) {
                const it = items[nextToPlace++];
                if (!it.failed) { masonryAppendInto(state, it); placed++; }
            }
            if (remaining > 0) masonryStatus(`正在解析图片尺寸… 剩余 ${remaining} 张`);
            else masonryStatus('');
            if (nextToPlace >= items.length && !placed && items.length) {
                grid.innerHTML = '<p class="gallery-page__empty">图片暂时无法加载</p>';
                masonryState = null;
            }
        }

        let active = 0, qi = 0;
        function pump() {
            if (gen !== masonryGeneration) return;
            while (active < MASONRY_MAX_PARALLEL && qi < queue.length) {
                const it = queue[qi++];
                active++;
                const im = new Image();
                const done = (w, h, failed) => {
                    if (gen !== masonryGeneration || it.ratio !== undefined) return;
                    active--;
                    remaining--;
                    if (failed) it.failed = true;
                    it.ratio = (w > 0 && h > 0) ? w / h : 3 / 4;
                    if (!failed && w > 0) { cache[it.url] = [w, h]; writeDimsCache(cache); }
                    flush();
                    pump();
                };
                im.onload = () => done(im.naturalWidth, im.naturalHeight, false);
                im.onerror = () => done(0, 0, true);
                setTimeout(() => { if (it.ratio === undefined) done(3 / 4, 1, false); }, MASONRY_TIMEOUT);
                im.src = it.url;
            }
        }

        flush();
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
                    <span class="album-detail__count">${images.length} 张</span>
                </div>
                ${(album.author || source) ? `
                    <div class="album-detail__meta">
                        ${album.author ? `<span class="album-detail__author">作者：${esc(album.author)}</span>` : ''}
                        ${source ? `<a class="album-detail__source" href="${source}" target="_blank" rel="noopener">查看原始链接 ↗</a>` : ''}
                    </div>
                ` : ''}
            `;
        }

        if (!images.length) {
            grid.innerHTML = '<p class="gallery-page__empty">这个写真集还没有照片</p>';
            curImages = [];
            return;
        }

        curImages = images.filter(Boolean);
        renderMasonry(images.map((url, i) => ({ url, alt: `写真 ${i + 1}` })));
    }

    /* ---------- 作品图集兼容 ---------- */

    function renderWorkGallery() {
        let work = null;
        if (catIndex !== null && categories[catIndex] && categories[catIndex].items && categories[catIndex].items[workIndex]) {
            work = categories[catIndex].items[workIndex];
        } else if (workIndex !== null && categories.length && categories[0] && categories[0].items && categories[0].items[workIndex]) {
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

        if (!images.length) {
            grid.innerHTML = '<p class="gallery-page__empty">这个作品还没有剧照</p>';
            curImages = [];
            return;
        }

        curImages = images.filter(Boolean);
        renderMasonry(images.map((url, i) => ({ url, alt: `剧照 ${i + 1}` })));
    }

    /* ---------- 入口 ---------- */

    if (albumIndex !== null && albums[albumIndex]) {
        renderAlbum(albums[albumIndex], parseInt(albumIndex, 10));
    } else if (catIndex !== null || workIndex !== null) {
        renderWorkGallery();
    } else {
        renderList();
    }

    // 动态内容直接显示，避免滚动动画隐藏
    Array.prototype.forEach.call(grid.querySelectorAll('.gallery__item, .album-card'), el => {
        el.classList.add('is-visible');
    });

    bindLightbox();
    setupNav();
})();
