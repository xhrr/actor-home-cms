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

    /* ---------- 灯箱 ---------- */

    function bindLightbox() {
        const lightbox = document.getElementById('lightbox');
        const lightboxImg = document.getElementById('lightbox-img');
        if (!lightbox || !lightboxImg) return;

        function open(src) {
            lightboxImg.src = src;
            lightbox.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }

        function close() {
            lightbox.style.display = 'none';
            lightboxImg.src = '';
            document.body.style.overflow = '';
        }

        grid.querySelectorAll('.gallery__item img').forEach(img => {
            img.addEventListener('click', () => open(img.currentSrc || img.src));
        });

        const closeBtn = document.getElementById('lightbox-close');
        if (closeBtn) closeBtn.addEventListener('click', close);
        lightbox.addEventListener('click', e => {
            if (e.target === lightbox || e.target === lightboxImg) close();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') close();
        });
    }

    /* ---------- 写真集列表 ---------- */

    function renderList() {
        if (top) {
            top.innerHTML = `
                <p class="gallery-page__eyebrow">GALLERY</p>
                <h1 class="gallery-page__title">${esc(gallery.heading || '写真')}</h1>
                <p class="gallery-page__desc">共 ${albums.length} 个写真集</p>
            `;
        }

        if (!albums.length) {
            grid.innerHTML = '<p class="gallery-page__empty">暂无写真集</p>';
            return;
        }

        grid.innerHTML = `
            <div class="gallery__albums">
                ${albums.map((album, ai) => {
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
            return;
        }

        grid.innerHTML = `
            <div class="album-masonry">
                ${images.map((url, i) => `
                    <figure class="gallery__item">
                        <img src="${safeUrl(url, 'image')}" alt="写真 ${i + 1}" loading="lazy" onerror="this.style.display='none'">
                    </figure>
                `).join('')}
            </div>
        `;
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
            return;
        }

        grid.innerHTML = `
            <div class="album-masonry">
                ${images.map((url, i) => `
                    <figure class="gallery__item">
                        <img src="${safeUrl(url, 'image')}" alt="剧照 ${i + 1}" loading="lazy" onerror="this.style.display='none'">
                    </figure>
                `).join('')}
            </div>
        `;
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
