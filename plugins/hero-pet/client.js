/**
 * 首页 Q 版宠物（前端）
 *
 * 由通用插件钩子注入（manifest.inject = true），NAS 实时站与公共站一致。
 * 定位：hero 与下一板块的分界线 = hero.nextElementSibling 的上边缘。
 *   静默时趴在分界线上（此时分界线就在视口底部 = hero 右下角）；
 *   向下滚动时分界线上移，宠物脚踩线跟随上移并按进度淡出；回滚再淡入。
 *
 * 姿态（assets/ 三帧，均由统一画布导出、脚底对齐画布底部，故换姿态不跳位置）：
 *   idle  趴卧（静默）  stand 站立（被拖动）  run 跃起小跑（蹦跳移动中）
 *
 * 设计约束：
 *   - 不改动站点原有文件；本脚本自判 hero 是否存在，子页面自动 no-op；
 *   - 不依赖 GSAP/Lenis（motion.js 可移除），只用 rAF + transform，走合成层；
 *   - 样式由脚本自注入（主题/站点 CSS 零改动）；
 *   - 分界线位置一律用 getBoundingClientRect().top 实测，绝不用 100vh 硬算
 *     （移动端地址栏收放会让 100vh 与真实可视高不一致）。
 */
(function () {
    'use strict';

    if (window.__HERO_PET_LOADED__) return;
    window.__HERO_PET_LOADED__ = true;

    var DEFAULTS = {
        enabled: true,
        size: 96,           // 宠物画布高度（px）
        hopStride: 110,     // 每跳的水平距离（px，越小跳得越密）
        hopHeight: 30,      // 跳跃高度（px）
        hopDuration: 340,   // 单次跳跃时长（ms）
        clickMove: true,    // 点击 hero 蹦跳过去
        draggable: true,    // 允许鼠标/手指拖动
        fallDuration: 1800, // 松手后落回分界线的时长（ms，越大越缓慢）
        startSide: 'right', // 初始位置：right / left
        mobileScale: 0.72   // 窄屏缩放（≤640px）
    };

    function readConfig() {
        try {
            var d = (window.SITE_CONFIG && window.SITE_CONFIG.plugins && window.SITE_CONFIG.plugins.data) || {};
            return Object.assign({}, DEFAULTS, d['hero-pet'] || {});
        } catch (e) { return Object.assign({}, DEFAULTS); }
    }

    var cfg = readConfig();
    if (cfg.enabled === false) return;

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- 样式（自注入，不改动站点 CSS） ----------
       形象为位图，故动效为整体：静默呼吸、蹦跳时压缩-拉伸（hpHop，与 JS 抛物线叠加）、
       落地挤压、点击跳跃。位移一律由 JS 写 transform，动画只作用于内层 img。 */
    var CSS = '' +
        '.hero-pet{position:fixed;left:0;top:0;z-index:5;pointer-events:auto;cursor:grab;' +
        'will-change:transform,opacity;touch-action:none;-webkit-tap-highlight-color:transparent;}' +
        '.hero-pet *{box-sizing:border-box;}' +
        '.hero-pet.hp-grab{cursor:grabbing;}' +
        '.hero-pet .hp-flip{transform:scaleX(var(--hp-dir,1));transition:transform .18s ease;}' +
        '.hero-pet img{display:block;width:100%;height:auto;user-select:none;-webkit-user-drag:none;' +
        'filter:drop-shadow(0 6px 8px rgba(0,0,0,.18));transform-origin:50% 100%;' +
        'animation:hpBreathe 3.6s ease-in-out infinite;}' +
        '.hero-pet.hp-grab img,.hero-pet.hp-fall img{animation:none;}' +
        '.hero-pet.hp-moving img{animation:hpHop var(--hp-hop,340ms) ease-in-out infinite;}' +
        '.hero-pet.hp-land img{animation:hpLand .34s ease-out;}' +
        '.hero-pet.hp-happy img{animation:hpHappy .9s ease-out;}' +
        '.hero-pet.hp-happy::after{content:"♥";position:absolute;left:50%;top:-.2em;' +
        'transform:translateX(-50%);color:#e58aa8;font-size:1.1rem;' +
        'animation:hpHeart .9s ease-out forwards;pointer-events:none;}' +
        '@keyframes hpBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.016)}}' +
        '@keyframes hpHop{0%{transform:scale(1.06,.9)}22%{transform:scale(.97,1.07)}' +
        '60%{transform:scale(1,1)}84%{transform:scale(1.06,.92)}100%{transform:scale(1.06,.9)}}' +
        '@keyframes hpLand{0%{transform:scale(1,1)}40%{transform:scale(1.09,.88) translateY(1.5px)}' +
        '70%{transform:scale(.98,1.03)}100%{transform:scale(1,1)}}' +
        '@keyframes hpHappy{0%{transform:translateY(0)}30%{transform:translateY(-8px)}' +
        '60%{transform:translateY(0)}75%{transform:translateY(-3.5px)}100%{transform:translateY(0)}}' +
        '@keyframes hpHeart{0%{opacity:0;transform:translate(-50%,4px) scale(.6)}' +
        '35%{opacity:1}100%{opacity:0;transform:translate(-50%,-22px) scale(1)}}' +
        '@media (prefers-reduced-motion: reduce){.hero-pet img{animation:none!important}}';

    function ensureStyle() {
        if (document.getElementById('heroPetStyle')) return;
        var s = document.createElement('style');
        s.id = 'heroPetStyle';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    /* ---------- 形象素材：三帧姿态（站长提供的白博美插画） ----------
       路径由脚本自身 URL 推导，导出到公共站（dist/plugins/hero-pet/）后同样可用。
       三帧同一画布 200x192、脚底对齐底部 → 换姿态时脚不会离地。 */
    var PET_SELF = (document.currentScript && document.currentScript.src) || '';
    var PET_BASE = PET_SELF ? PET_SELF.replace(/client\.js.*$/, '') : '/plugins/hero-pet/';
    var POSES = {
        idle: PET_BASE + 'assets/pom-idle.png',
        stand: PET_BASE + 'assets/pom-stand.png',
        run: PET_BASE + 'assets/pom-run.png'
    };
    var PET_RATIO = 200 / 192; // 画布宽 / 高

    /* ---------- 状态 ---------- */
    var pet = null, imgEl = null;   // 根元素（承载位移）/ 形象 img（承载姿态动画）
    var hero = null;                // hero 元素（.hero / .hero-split）
    var bond = null;                // 分界线 = hero 的下一个兄弟（下一板块）
    var petH = 0, petW = 0;         // 显示尺寸
    var x = 0, y = 0;               // 当前位置（视口坐标，宠物左上角）
    var walk = null;                // 蹦跳移动：{ fromX, toX, start, dur, hops, hopH }
    var fall = null;                // 松手落回：{ fromY, toY, start, dur }
    var drag = null;                // 拖拽中：{ startX, startY, petX, petY, moved }
    var justDragged = false;        // 抑制拖拽结束后紧跟的 click
    var curPose = '';               // 当前姿态
    var frame = 0;                  // rAF id
    var ready = false;

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function maxX() { return Math.max(6, (window.innerWidth || 0) - petW - 6); }
    function s(v) { return v * petH / 96; }   // 按显示尺寸缩放像素参数

    function setPose(name) {
        if (curPose === name || !imgEl || !POSES[name]) return;
        curPose = name;
        imgEl.src = POSES[name];
    }

    // 落回地面的缓动：末端轻微回弹，配合较长时长显得缓慢柔和
    function easeOutBounce(t) {
        var n1 = 7.5625, d1 = 2.75;
        if (t < 1 / d1) return n1 * t * t;
        if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
        if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
        t -= 2.625 / d1;
        return n1 * t * t + 0.984375;
    }

    // 触地挤压（一次）
    function landSquash() {
        if (!pet) return;
        pet.classList.remove('hp-land');
        void pet.offsetWidth;                 // 强制回流，可重放
        pet.classList.add('hp-land');
        setTimeout(function () { pet.classList.remove('hp-land'); }, 360);
    }

    /* ---------- 每帧：位置 + 姿态 ---------- */
    function applyFrame() {
        frame = 0;
        if (!ready || !pet || !bond) return;

        var vh = window.innerHeight || 0;
        var top = bond.getBoundingClientRect().top; // 分界线实测 Y
        var hopY = 0;

        // 蹦跳移动：整体横向线性推进，纵向叠加逐跳抛物线
        if (walk) {
            var p = (performance.now() - walk.start) / walk.dur;
            if (p >= 1) {
                x = walk.toX;
                walk = null;
                pet.classList.remove('hp-moving');
                setPose('idle');
                landSquash();
            } else {
                x = walk.fromX + (walk.toX - walk.fromX) * p;
                var hp = p * walk.hops;
                var local = hp - Math.floor(hp);
                hopY = -walk.hopH * Math.sin(Math.PI * local); // 0→峰→0
            }
        }

        // 纵向：拖拽跟手 → 松手落回 → 常态脚踩分界线（+ 跳跃高度）
        if (drag) {
            // y 已由 onPointerMove 按不可变基准写入
        } else if (fall) {
            var fp = clamp((performance.now() - fall.start) / fall.dur, 0, 1);
            y = fall.fromY + (fall.toY - fall.fromY) * easeOutBounce(fp);
            if (fp >= 1) {
                fall = null;
                pet.classList.remove('hp-fall');
                setPose('idle');
                landSquash();
            }
        } else {
            y = top - petH + hopY;
        }

        pet.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';

        // 淡出：分界线上移到中部时渐隐（回滚淡入）；拖拽中始终可见
        var op = (reduceMotion || drag) ? 1 : clamp((top / vh - 0.5) / 0.45, 0, 1);
        pet.style.opacity = op.toFixed(3);
        pet.style.pointerEvents = op < 0.06 ? 'none' : 'auto';

        if (walk || fall) frame = requestAnimationFrame(applyFrame);
    }

    function schedule() { if (!frame) frame = requestAnimationFrame(applyFrame); }

    /* ---------- 蹦跳移动 ---------- */
    function walkTo(targetX) {
        if (!ready) return;
        targetX = clamp(targetX, 6, maxX());
        if (Math.abs(targetX - x) < 4) return;
        // 素材朝左（头在左、尾在右）：往左保持朝向，往右翻转
        pet.style.setProperty('--hp-dir', targetX < x ? 1 : -1);

        if (reduceMotion) {                    // 减弱动效：直接就位，不蹦
            x = targetX; setPose('idle'); applyFrame(); return;
        }
        var dist = Math.abs(targetX - x);
        var stride = Math.max(24, s(cfg.hopStride || 110));
        var hops = clamp(Math.round(dist / stride), 1, 24);
        var hopDur = Math.max(140, parseInt(cfg.hopDuration, 10) || 340);
        walk = {
            fromX: x, toX: targetX, start: performance.now(),
            dur: hops * hopDur, hops: hops,
            hopH: Math.max(6, s(cfg.hopHeight || 30))
        };
        pet.style.setProperty('--hp-hop', hopDur + 'ms');
        pet.classList.add('hp-moving');
        setPose('run');
        schedule();
    }

    /* ---------- 互动：打招呼（冒爱心 + 轻跳） ---------- */
    function happy() {
        if (!pet) return;
        pet.classList.remove('hp-happy');
        void pet.offsetWidth;
        pet.classList.add('hp-happy');
        setTimeout(function () { pet.classList.remove('hp-happy'); }, 900);
    }

    /* ---------- 拖拽：按住拖走，松手落回分界线 ---------- */
    function onPointerDown(e) {
        if (!ready || !cfg.draggable || !pet || e.button > 0) return;
        e.preventDefault();
        walk = null; fall = null;
        pet.classList.remove('hp-moving', 'hp-fall');
        drag = { startX: e.clientX, startY: e.clientY, petX: x, petY: y, moved: false };
        pet.classList.add('hp-grab');
        setPose('stand');                       // 被拎起 → 站姿
        if (pet.setPointerCapture) { try { pet.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } }
        schedule();
    }

    function onPointerMove(e) {
        if (!drag) return;
        var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (!drag.moved) return;
        e.preventDefault();
        // 以按下时位置为不可变基准 + 总位移，避免逐次累加漂移
        x = clamp(drag.petX + dx, 6, maxX());
        y = clamp(drag.petY + dy, 0, (window.innerHeight || 0) - petH);
        schedule();
    }

    function endDrag() {
        if (!drag) return;
        var moved = drag.moved, fromY = y;
        drag = null;
        pet.classList.remove('hp-grab');
        if (moved) {
            justDragged = true;
            var toY = bond.getBoundingClientRect().top - petH;
            var dur = Math.max(300, parseInt(cfg.fallDuration, 10) || 1800);
            fall = { fromY: fromY, toY: toY, start: performance.now(), dur: dur };
            pet.classList.add('hp-fall');
            setPose('run');                     // 下落时收腿
            schedule();
        } else {
            happy();
        }
    }

    /* ---------- 点击 hero 移动 / 点击宠物互动 ---------- */
    function onDocClick(e) {
        if (!ready) return;
        if (justDragged) { justDragged = false; return; }
        if (pet && pet.contains(e.target)) return;        // 宠物本体点击由 pointerup 处理
        if (!cfg.clickMove) return;
        if (!hero || !hero.contains(e.target)) return;
        if (e.target.closest && e.target.closest('a,button,input,select,textarea,[role="button"]')) return;
        walkTo(e.clientX - petW / 2);                     // 宠物中心落到点击处
    }

    /* ---------- 初始化 ---------- */
    function init() {
        hero = document.querySelector('#app > .hero, #app > .hero-split, .hero, .hero-split');
        if (!hero) return;                              // 子页面：无 hero，不启用
        bond = hero.nextElementSibling;
        if (!bond) return;
        if (document.getElementById('heroPet')) return; // 幂等

        var base = Math.max(48, parseInt(cfg.size, 10) || 96);
        if ((window.innerWidth || 9999) <= 640) base = Math.round(base * (cfg.mobileScale || 0.72));
        petH = base;
        petW = Math.round(petH * PET_RATIO);

        ensureStyle();

        // 预载三帧，换姿态即时无闪烁
        Object.keys(POSES).forEach(function (k) { var im = new Image(); im.src = POSES[k]; });

        pet = document.createElement('div');
        pet.id = 'heroPet';
        pet.className = 'hero-pet';
        pet.setAttribute('role', 'img');
        pet.setAttribute('aria-label', '首页小宠物');
        pet.style.width = petW + 'px';

        imgEl = document.createElement('img');
        imgEl.src = POSES.idle;
        imgEl.alt = '';
        imgEl.draggable = false;
        imgEl.decoding = 'async';
        curPose = 'idle';

        var flip = document.createElement('div');
        flip.className = 'hp-flip';
        flip.appendChild(imgEl);
        pet.appendChild(flip);
        document.body.appendChild(pet);

        x = (cfg.startSide === 'left') ? 6 : maxX();
        ready = true;
        applyFrame();

        pet.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
        document.addEventListener('click', onDocClick, false);
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', function () {
            x = clamp(x, 6, maxX());
            schedule();
        }, { passive: true });
        setTimeout(schedule, 300);              // 分界线受字体/图片加载影响，迟一拍对齐
    }

    // 等待 hero 渲染完成（client.js 早于 main.js 执行；main.js 同步渲染 hero 后可用）
    function waitHero(deadline) {
        if (document.querySelector('.hero, .hero-split')) { init(); return; }
        if (performance.now() > deadline) return;
        requestAnimationFrame(function () { waitHero(deadline); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { waitHero(performance.now() + 4000); });
    } else {
        waitHero(performance.now() + 4000);
    }
})();
