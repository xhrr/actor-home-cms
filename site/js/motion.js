/**
 * Actor Home CMS — 全站动效引擎（Lenis 平滑滚动 + GSAP ScrollTrigger）
 *
 * 接管范围：
 *   1. Lenis 桌面平滑滚动（触屏保持原生滚动，smoothTouch 默认 false）
 *   2. hero 入场编排 + 桌面滚动视差（图片慢沉、文字快升，两层速度差）
 *   3. 板块标题二级揭示（label 淡入 → title 遮罩升起）
 *   4. 图片遮罩揭示（封面自下而上"擦出"）
 *   5. 卡片/条目 stagger 显现（接管原 IntersectionObserver reveal）
 *
 * 加载顺序：vendor（lenis/gsap/ScrollTrigger）→ 页面渲染 JS → 本文件。
 * 全部为同步脚本：首次渲染前初始态已就位，无 FOUC。
 * 降级：任一库缺失时直接退出，页面回退到原生 CSS/IO reveal 体系。
 */
(function () {
    'use strict';

    if (!window.Lenis || !window.gsap || !window.ScrollTrigger) return;

    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isTouch = window.matchMedia('(hover: none)').matches;

    /* ---------- Lenis 平滑滚动 ----------
       lerp 0.1：跟手且有余韵；anchors:true 接管导航 #锚点跳转。
       ScrollTrigger.update 联动：Lenis 滚动时同步刷新触发器进度。 */
    let lenis = null;
    if (!reduceMotion) {
        lenis = new Lenis({
            autoRaf: true,
            anchors: true,
            lerp: 0.1
        });
        lenis.on('scroll', ScrollTrigger.update);
    }

    /* ---------- 标记：CSS 据此解除原 IO reveal 的 opacity/transform 过渡 ----------
       （GSAP 逐帧写 inline style，若保留 CSS transition 会把每帧拖成惯性跟随） */
    document.documentElement.classList.add('motion-gsap');

    /* ---------- 灯箱联动：打开时锁定背景滚动 ---------- */
    const lightbox = document.getElementById('lightbox');
    if (lightbox && lenis) {
        new MutationObserver(() => {
            if (lightbox.classList.contains('is-open')) lenis.stop();
            else lenis.start();
        }).observe(lightbox, { attributes: true, attributeFilter: ['class'] });
    }

    /* ---------- hero 下滑引导（方案③） ----------
       底部呼吸细线 + chevron，点击平滑滚到下一板块；
       滚动 40px 后自动淡出（非 reduced 分支内挂载） */
    const heroEl = document.querySelector('.hero, .hero-split');
    let scrollHint = null;
    if (heroEl) {
        scrollHint = document.createElement('button');
        scrollHint.className = 'hero__scroll-hint';
        scrollHint.type = 'button';
        scrollHint.setAttribute('aria-label', '下滑探索');
        scrollHint.innerHTML = '<span></span>';
        scrollHint.addEventListener('click', () => {
            const next = heroEl.nextElementSibling;
            if (!next) return;
            if (lenis) lenis.scrollTo(next);
            else next.scrollIntoView();
        });
        heroEl.appendChild(scrollHint);
    }

    const REVEAL_TARGETS = '.work-item, .gallery__item, .news-item, .award-item, .schedule-item, .album-card';
    const revealEls = document.querySelectorAll(REVEAL_TARGETS);
    const heads = document.querySelectorAll('.section__head');

    /* ---------- 减弱动效偏好：全部内容直接可见，不创建任何动画 ----------
       （选择器先取集合再判空：无匹配元素时 GSAP 会 console 警告） */
    if (reduceMotion) {
        const all = document.querySelectorAll(REVEAL_TARGETS + ', .section__head, .section__label, .section__title');
        if (all.length) {
            gsap.set(all, { opacity: 1, y: 0, clipPath: 'none', clearProps: 'transform' });
        }
        return;
    }

    /* ---------- 卡片/条目 stagger 显现（接管原 IO reveal） ----------
       batch 按"同帧进入视口"分批，批内 75ms 阶梯，比 CSS nth-child 固定阶梯更自然 */
    if (revealEls.length) {
        gsap.set(revealEls, { opacity: 0, y: 14 });
        ScrollTrigger.batch(revealEls, {
            start: 'top 92%',
            once: true,
            onEnter: batch => gsap.to(batch, {
                opacity: 1,
                y: 0,
                duration: 0.7,
                ease: 'power3.out',
                stagger: 0.075,
                overwrite: 'auto'
            })
        });
    }

    /* ---------- 板块标题二级揭示 ----------
       head 容器直接复位（不再整体 fade），label 先淡入，title 延迟 120ms
       从遮罩中升起（clip 底部展开 + 上移归位），编辑杂志"揭幕"感 */
    if (heads.length) gsap.set(heads, { opacity: 1, y: 0 });
    heads.forEach(head => {
        const label = head.querySelector('.section__label');
        const title = head.querySelector('.section__title');
        if (!label && !title) return;
        const tl = gsap.timeline({
            scrollTrigger: { trigger: head, start: 'top 88%', once: true }
        });
        if (label) {
            tl.fromTo(label,
                { opacity: 0, y: 10 },
                { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 0);
        }
        if (title) {
            tl.fromTo(title,
                { opacity: 0, y: '0.35em', clipPath: 'inset(0% 0% 110% 0%)' },
                { opacity: 1, y: 0, clipPath: 'inset(0% 0% -25% 0%)', duration: 0.9, ease: 'power3.out' }, 0.12);
        }
    });

    /* ---------- hero：入场编排（接管 CSS hero-enter 动画）+ 桌面滚动视差 ----------
       入场终态 scale 1.12 即视差余量基准（位移 5% < 余量 6%，不露边）；
       y(px) 与 yPercent 是 GSAP 独立通道，入场位移与视差位移可叠加 */
    const heroImg = document.querySelector('.hero__media img');
    const heroContent = document.querySelector('.hero__content');
    if (heroImg) {
        const enterTl = gsap.timeline();
        enterTl.fromTo(heroImg,
            { opacity: 0, y: 18, scale: 1.06 },
            { opacity: 1, y: 0, scale: isTouch ? 1 : 1.12, duration: 1.6, ease: 'power3.out' }, 0);
        if (heroContent) {
            enterTl.fromTo(heroContent,
                { opacity: 0, y: 14 },
                { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 0.3);
        }

        /* 桌面视差：图片慢速下沉、文字快速上移离开，两层速度差形成纵深。
           与 sticky 叠层配合：hero 钉在底层下沉的同时被 About 盖上（方案①），
           覆盖运动 + 视差叠加成双重纵深。
           移动端不创建——触屏优先丝滑，不叠加滚动逐帧动画 */
        if (!isTouch) {
            gsap.to(heroImg, {
                yPercent: 5,
                ease: 'none',
                scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
            });
            if (heroContent) {
                gsap.to(heroContent, {
                    yPercent: -12,
                    ease: 'none',
                    scrollTrigger: { trigger: '.hero', start: 'top top', end: '70% top', scrub: true }
                });
            }
        }

        /* 下滑引导：滚动 40~160px 间淡出 */
        if (scrollHint) {
            gsap.to(scrollHint, {
                opacity: 0,
                ease: 'none',
                scrollTrigger: { start: 40, end: 160, scrub: true }
            });
        }
    }
})();
