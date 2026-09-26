/**
 * newgallery.js — 「瞬间」拍立得瀑布流（/newgallery.html 独立页面）
 *
 * 数据：config.gallery.albums 铺平为单张照片（一张一卡），按图集日期降序、无日期垫底；
 *       全库 URL 去重（跨图集重复图只保留最新一条）。
 * 性能：
 *  - 分批渲染（每批 60）+ 哨兵 IntersectionObserver（提前 800px 追加）——同 gallery.js 已验证方案
 *  - img 原生 loading=lazy + decoding=async
 *  - 加载前 aspect-ratio 3/4 占位（多数竖图），onload 写回真实比例：布局稳定、无跳变
 *  - 列高度用 JS 估算（列宽/比例 + 常数），追加批时零 DOM 回读
 *  - 卡片 content-visibility:auto 跳过屏外布局/绘制
 *  - 不引动效引擎（无 Lenis/GSAP），过渡只走 transform/box-shadow
 */
(function () {
    'use strict';

    const grid = document.getElementById('ngGrid');
    const tabsEl = document.getElementById('ngTabs');
    if (!grid) return;

    const T = (window.I18N && window.I18N.t) || ((key, fallback) => (fallback == null ? key : fallback));

    /* ---------------- 工具 ---------------- */

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    const safeUrl = u => {
        const s = String(u || '').trim();
        return /^https?:\/\//.test(s) ? s : '';
    };

    /** 稳定伪随机倾斜（同一条目重渲染角度不变）：-3° ~ +3° */
    function tiltOf(i) {
        let h = (i + 1) * 2654435761;
        h = (h ^ (h >>> 13)) * 1274126177;
        h = (h ^ (h >>> 16)) >>> 0;
        return ((h % 61) / 10 - 3).toFixed(1);
    }

    const GAP = () => window.innerWidth <= 768 ? 18 : 26;
    const CAP_H = 48;           // 卡片图注区估算高（含内边距）
    const BATCH = 60;

    /* ---------------- 数据 ---------------- */

    let photos = [];            // 全量（已按时间排序、URL 去重）
    let filtered = [];          // 当前年份筛选下的渲染队列
    let yearFilter = '';        // '' = 全部
    // URL 直达筛选：/newgallery.html?y=2024（可分享/回跳）
    const yParam = (location.search || '').match(/[?&]y=(\d{4})/);
    if (yParam) yearFilter = yParam[1];
    let photoRatio = new Map(); // url → 宽高比（数字）。⚠️ 必须存数字：列高估算参与除法，
                                // 存成 {w,h} 对象会得到 NaN → 最短列判断失效 → 全部堆进第一列

    function flatten() {
        const C = window.SITE_CONFIG || {};
        const albums = (C.gallery && Array.isArray(C.gallery.albums)) ? C.gallery.albums.slice() : [];
        // 日期降序、无日期垫底；同日期保持原数组顺序
        const dated = albums.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(String(a && a.date || '')));
        const undated = albums.filter(a => !/^\d{4}-\d{2}-\d{2}$/.test(String(a && a.date || '')));
        dated.sort((a, b) => String(b.date).localeCompare(String(a.date)));

        const seen = new Set();
        const out = [];
        const push = (album, idx) => {
            const list = Array.isArray(album.images) ? album.images : [];
            const cover = safeUrl(album.cover);
            // 封面在 images 里通常已存在；不在则补入（封面也是一张图）
            const urls = list.map(safeUrl).filter(Boolean);
            if (cover && urls.indexOf(cover) < 0) urls.unshift(cover);
            for (const url of urls) {
                if (seen.has(url)) continue;
                seen.add(url);
                out.push({ url, title: String(album.title || '').trim(), date: String(album.date || ''), key: (album.id || 'a') + '-' + idx });
            }
        };
        dated.forEach(push);
        undated.forEach(push);
        return out;
    }

    function yearsOf() {
        const set = new Set();
        for (const p of photos) if (p.date) set.add(p.date.slice(0, 4));
        return [...set].sort((a, b) => b.localeCompare(a));
    }

    /* ---------------- 瀑布流 ---------------- */

    let colCount = 0;
    let colEls = [];
    let colH = [];              // 各列估算高度
    let rendered = 0;
    let sentinel = null;
    let sentinelIO = null;

    function columnsFor(width) {
        if (width >= 1240) return 5;
        if (width >= 1000) return 4;
        if (width >= 760) return 3;
        return 2;
    }

    function cardHtml(p, i) {
        const r = photoRatio.get(p.url);
        const ratioAttr = r ? r : '3 / 4'; // 数字比例（CSS aspect-ratio 接受单值）或占位 3/4
        const alt = esc(p.title || T('moments.photo', '照片'));
        return `<figure class="ng-card" style="--tilt:${tiltOf(i)}deg" role="button" tabindex="0" data-i="${i}"
                    aria-label="${alt}">
                    <div class="ng-card__ph" style="aspect-ratio:${ratioAttr}">
                        <img src="${esc(p.url)}" alt="${alt}" loading="lazy" decoding="async">
                    </div>
                    <figcaption class="ng-card__cap">
                        <span class="ng-card__title">${esc(p.title || '')}</span>
                        <span class="ng-card__date">${esc(p.date)}</span>
                    </figcaption>
                </figure>`;
    }

    /** 估算一张卡在当前列宽下的高度（与 CSS 结构对应） */
    function cardEstimate(ratio) {
        const colW = colWidth;
        return colW / (ratio || 3 / 4) + CAP_H;
    }

    let colWidth = 0;

    function appendBatch() {
        if (rendered >= filtered.length) return;
        const start = rendered;
        const end = Math.min(start + BATCH, filtered.length);
        const gap = GAP();
        for (let i = start; i < end; i++) {
            // 最短列追加（估算高度，不读 DOM）
            let col = 0;
            for (let c = 1; c < colCount; c++) if (colH[c] < colH[col]) col = c;
            const p = filtered[i];
            const tmp = document.createElement('div');
            tmp.innerHTML = cardHtml(p, i);
            const card = tmp.firstElementChild;
            colEls[col].appendChild(card);
            colH[col] += cardEstimate(photoRatio.get(p.url)) + gap;
            bindCard(card, i);
        }
        rendered = end;

        if (sentinel) { sentinel.remove(); sentinel = null; }
        if (rendered < filtered.length) {
            sentinel = document.createElement('div');
            sentinel.className = 'ng-sentinel';
            sentinel.setAttribute('aria-hidden', 'true');
            grid.appendChild(sentinel);
            if (!('IntersectionObserver' in window)) {
                appendBatch(); // 无 IO：一次性补齐（极老浏览器降级）
                return;
            }
            if (!sentinelIO) {
                sentinelIO = new IntersectionObserver(entries => {
                    if (entries.some(e => e.isIntersecting)) appendBatch();
                }, { rootMargin: '800px 0px' });
            }
            sentinelIO.observe(sentinel);
            // 哨兵已在视口内时 IO 首回调要等下一帧，主动补一批避免空档
            requestAnimationFrame(() => {
                if (!sentinel || rendered >= filtered.length) return;
                const r = sentinel.getBoundingClientRect();
                if (r.top < (window.innerHeight || 0) + 800) appendBatch();
            });
        }
    }

    function teardown() {
        if (sentinelIO) { sentinelIO.disconnect(); }
        if (sentinel) { sentinel.remove(); sentinel = null; }
        grid.innerHTML = '';
        rendered = 0;
    }

    function render() {
        teardown();
        if (!filtered.length) {
            grid.innerHTML = `<p class="ng-empty">${esc(T('moments.emptyYear', '这个时间段还没有照片'))}</p>`;
            return;
        }
        colCount = columnsFor(grid.clientWidth || window.innerWidth);
        colWidth = Math.floor(((grid.clientWidth || window.innerWidth) - GAP() * (colCount - 1)) / colCount);
        colEls = [];
        colH = [];
        for (let c = 0; c < colCount; c++) {
            const col = document.createElement('div');
            col.className = 'ng-col';
            grid.appendChild(col);
            colEls.push(col);
            colH.push(0);
        }
        appendBatch();
    }

    /* ---------------- 图片比例回填 ---------------- */

    function onImgLoad(img, url, card) {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return;
        // 首载也要修正：占位估算基于 3/4，真实比例与占位的差值补回所在列
        const prev = photoRatio.get(url) || 3 / 4;
        const ratio = w / h;
        photoRatio.set(url, ratio);
        const ph = card.querySelector('.ng-card__ph');
        if (ph) ph.style.aspectRatio = `${w} / ${h}`;
        const delta = colWidth / ratio - colWidth / prev;
        for (let c = 0; c < colCount; c++) {
            if (colEls[c] && colEls[c].contains(card)) { colH[c] += delta; break; }
        }
    }

    function bindCard(card, i) {
        const img = card.querySelector('img');
        const p = filtered[i];
        if (img && p) {
            if (img.complete && img.naturalWidth) onImgLoad(img, p.url, card);
            else img.addEventListener('load', () => onImgLoad(img, p.url, card), { once: true });
        }
        const open = () => openLightbox(i);
        card.addEventListener('click', open);
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
    }

    /* ---------------- 年份筛选 ---------------- */

    function renderTabs() {
        const years = yearsOf();
        const tabs = [{ key: '', label: T('common.all', '全部') }].concat(years.map(y => ({ key: y, label: y })));
        tabsEl.innerHTML = tabs.map(t =>
            `<button type="button" class="ng-tab${t.key === yearFilter ? ' is-active' : ''}" data-year="${t.key}">${esc(t.label)}</button>`
        ).join('');
    }

    tabsEl.addEventListener('click', e => {
        const btn = e.target.closest('.ng-tab');
        if (!btn) return;
        yearFilter = btn.dataset.year || '';
        renderTabs();
        applyFilter();
    });

    function applyFilter() {
        filtered = yearFilter ? photos.filter(p => p.date.slice(0, 4) === yearFilter) : photos.slice();
        render();
    }

    /* ---------------- 灯箱 ---------------- */

    const lb = document.getElementById('lightbox');
    const lbImg = document.getElementById('ngLbImg');
    const lbBg = document.getElementById('ngLbBg');
    const lbTitle = document.getElementById('ngLbTitle');
    const lbMeta = document.getElementById('ngLbMeta');
    const lbCounter = document.getElementById('ngLbCounter');
    let lbIndex = -1;
    let touchX = null;

    /** 灯箱图加载态：is-loading 期间显示转圈，失败给明确提示（原图可达数 MB，走公网要几秒） */
    function setLbLoading(on) {
        lb.classList.toggle('is-loading', on);
    }

    function showLightbox() {
        const p = filtered[lbIndex];
        if (!p) return;
        setLbLoading(true);
        lbImg.onload = () => setLbLoading(false);
        lbImg.onerror = () => { setLbLoading(false); lbTitle.textContent = T('moments.imgFail', '图片加载失败'); };
        lbImg.src = p.url;
        lbImg.alt = p.title || T('moments.photo', '照片');
        // 模糊底用同一张图：卡片阶段已进缓存，点开瞬间即可见
        lbBg.src = p.url;
        lbTitle.textContent = p.title || '';
        lbMeta.textContent = p.date || '';
        lbCounter.textContent = `${lbIndex + 1} / ${filtered.length}`;
        preloadNeighbors();
    }

    /** 预加载左右邻图：翻页瞬间可见 */
    function preloadNeighbors() {
        [lbIndex - 1, lbIndex + 1].forEach(j => {
            const p = filtered[(j + filtered.length) % filtered.length];
            if (!p) return;
            const im = new Image();
            im.src = p.url;
        });
    }

    function openLightbox(i) {
        lbIndex = i;
        showLightbox();
        lb.style.display = 'flex';
        // editorial 的灯箱遮罩默认 opacity:0，全靠 .is-open 类淡入——
        // 只切 display 会得到「开着但透明」的遮罩：页面像卡死（点不进去、滚不动）
        void lb.offsetWidth; // 先让 display 生效，再加类，保证过渡能跑
        lb.classList.add('is-open');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lb.classList.remove('is-open');
        lbImg.onload = null;
        lbImg.onerror = null;
        lbImg.removeAttribute('src'); // 置空串会触发 onerror 并向页面自身发一次请求
        lbBg.removeAttribute('src');
        lb.style.display = 'none';
        document.body.style.overflow = '';
        lbIndex = -1;
    }

    function step(dir) {
        if (lbIndex < 0 || !filtered.length) return;
        lbIndex = (lbIndex + dir + filtered.length) % filtered.length;
        showLightbox();
    }

    document.getElementById('ngLbClose').addEventListener('click', closeLightbox);
    document.getElementById('ngLbPrev').addEventListener('click', () => step(-1));
    document.getElementById('ngLbNext').addEventListener('click', () => step(1));
    lb.addEventListener('click', e => {
        // 点空白（模糊区）关闭：模糊底层已 pointer-events:none，这里兜底再认一次它
        if (e.target === lb || e.target === lbBg) closeLightbox();
    });
    document.addEventListener('keydown', e => {
        if (lb.style.display === 'none') return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
    });
    lb.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => {
        if (touchX == null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
        touchX = null;
    }, { passive: true });

    /* ---------------- 尺寸变化：列数变了才整体重排（防抖） ---------------- */

    let resizeTimer = null;
    let lastWidth = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const w = grid.clientWidth || window.innerWidth;
            if (w === lastWidth) return;
            lastWidth = w;
            if (columnsFor(w) !== colCount) {
                const y = window.scrollY;
                render();
                window.scrollTo(0, Math.min(y, document.body.scrollHeight));
            } else {
                colWidth = Math.floor((w - GAP() * (colCount - 1)) / colCount);
            }
        }, 200);
    }, { passive: true });

    /* ---------------- 入口 ---------------- */

    window.CMS.initNavShell();

    const ready = (window.CMS && window.CMS.loadGallery) ? window.CMS.loadGallery() : Promise.resolve();
    ready.then(() => {
        photos = flatten();
        if (!photos.length) {
            tabsEl.innerHTML = '';
            grid.innerHTML = `<p class="ng-empty">${esc(T('moments.none', '还没有可展示的照片'))}</p>`;
            return;
        }
        if (yearFilter && !yearsOf().includes(yearFilter)) yearFilter = ''; // URL 带了不存在的年份则回全部
        renderTabs();
        applyFilter();
    }).catch(() => {
        grid.innerHTML = `<p class="ng-empty">${esc(T('moments.loadFail', '照片数据加载失败，请稍后刷新'))}</p>`;
    });
})();
