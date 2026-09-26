/**
 * 首页粒子 hero — 前端客户端
 * 保留站点照片与原有 hero 文案，叠加调性遮罩 + 高密度粒子场；
 * 点击 hero 空白处，全部粒子汇聚成所选拼形（月牙/心形/五角星/皇冠/花开，
 * 支持每次随机），一次心跳后就地散开。
 * 明暗调（tone）：dark = 暗色遮罩 + 暖白加色粒子；light = 底部米白渐变（只盖
 * 文字区）+ 墨色文字 + 白芯色晕发光珠（sprite）。
 * 配置：SITE_CONFIG.plugins.data['hero-photo'] = { enabled, shape, tone }。
 * canvas 2D，零依赖。只新增元素与 .hero--photo 类，不改站点现有逻辑。
 */
(function () {
    'use strict';

    if (window.__HERO_PHOTO_LOADED__) return;
    window.__HERO_PHOTO_LOADED__ = true;

    var DEFAULTS = {
        enabled: true,
        shape: 'moon',          /* moon | heart | star | crown | flower | random */
        tone: 'light'           /* light | dark */
    };
    var SHAPE_LIST = ['moon', 'heart', 'star', 'crown', 'flower'];

    function readConfig() {
        try {
            var d = (window.SITE_CONFIG && window.SITE_CONFIG.plugins &&
                window.SITE_CONFIG.plugins.data && window.SITE_CONFIG.plugins.data['hero-photo']) || {};
            var shape = d.shape == null ? DEFAULTS.shape : d.shape;
            if (shape !== 'random' && SHAPE_LIST.indexOf(shape) === -1) shape = DEFAULTS.shape;
            var tone = d.tone == null ? DEFAULTS.tone : d.tone;
            if (tone !== 'light' && tone !== 'dark') tone = DEFAULTS.tone;
            return { enabled: d.enabled !== false, shape: shape, tone: tone };
        } catch (_) {
            return { enabled: false, shape: DEFAULTS.shape, tone: DEFAULTS.tone };
        }
    }

    var STYLE =
        '.hero--photo{height:100vh;min-height:560px;padding:calc(var(--nav-h) + 2rem) 1.5rem 4.5rem}' +
        '.hero--photo .hero__media::after,.hero--photo .hero__mobile::after{opacity:0}' +
        /* 暗调遮罩（默认基类） */
        '.hero--photo .hw-shade{position:absolute;inset:0;z-index:1;pointer-events:none;' +
        'background:linear-gradient(to right,rgba(8,7,9,.70) 0%,rgba(8,7,9,.36) 44%,rgba(8,7,9,.10) 72%,rgba(8,7,9,0) 100%),' +
        'linear-gradient(to top,rgba(8,7,9,.90) 0%,rgba(8,7,9,.52) 26%,rgba(8,7,9,.16) 56%,rgba(8,7,9,.22) 100%)}' +
        '.hero--photo .hw-dust{position:absolute;inset:0;z-index:2;pointer-events:none}' +
        '.hero--photo .hw-grain{position:absolute;inset:0;z-index:3;pointer-events:none;opacity:.07;' +
        'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'160\' height=\'160\' filter=\'url(%23n)\'/%3E%3C/svg%3E")}' +
        '.hero--photo .hw-content{position:relative;z-index:4;max-width:var(--container);margin:0 auto;width:100%}' +
        '.hero--photo .hw-eyebrow{margin:0 0 1.1rem;font-family:var(--font-sans);font-size:.72rem;letter-spacing:.3em;text-transform:uppercase;color:rgba(242,241,238,.5)}' +
        '.hero--photo .hw-title{margin:0;font-family:var(--font-serif);font-size:clamp(3.4rem,9.5vw,7.2rem);font-weight:400;letter-spacing:-0.03em;line-height:1.0;color:#f2f1ee;text-shadow:0 1px 14px rgba(0,0,0,.45)}' +
        '.hero--photo .hw-rule{display:block;width:56px;height:2px;margin:1.7rem 0 0;background:#f9f8f6;box-shadow:0 0 12px rgba(249,248,246,.45)}' +
        '.hero--photo .hw-subtitle{margin:1.3rem 0 0;font-family:var(--font-serif);font-style:italic;font-size:1.08rem;letter-spacing:.06em;line-height:1.8;color:rgba(242,241,238,.75);text-shadow:0 1px 8px rgba(0,0,0,.4)}' +
        '.hero--photo .hero__scroll-hint{filter:invert(1) hue-rotate(180deg)}' +
        /* 明调：遮罩只盖底部文字区，照片保持通透；文字换墨色 */
        '.hero--photo.hw-tone-light .hw-shade{background:linear-gradient(to top,rgba(249,248,246,.97) 0%,rgba(249,248,246,.88) 20%,rgba(249,248,246,.55) 36%,rgba(249,248,246,.16) 54%,rgba(249,248,246,0) 70%)}' +
        '.hero--photo.hw-tone-light .hw-eyebrow{color:rgba(30,27,24,.48)}' +
        '.hero--photo.hw-tone-light .hw-title{color:#1c1a18;text-shadow:0 1px 12px rgba(249,248,246,.75)}' +
        '.hero--photo.hw-tone-light .hw-rule{background:#1c1a18;box-shadow:0 0 10px rgba(30,27,24,.22)}' +
        '.hero--photo.hw-tone-light .hw-subtitle{color:rgba(30,27,24,.72);text-shadow:0 1px 8px rgba(249,248,246,.6)}' +
        '.hero--photo.hw-tone-light .hero__scroll-hint{filter:none}' +
        '@media (max-width:760px){.hero--photo{padding:calc(var(--nav-h) + 2.5rem) 1.25rem 4.5rem}' +
        '.hero--photo .hw-title{font-size:clamp(3rem,15vw,4.6rem)}' +
        '.hero--photo .hw-subtitle{font-size:.95rem}}';

    function injectStyle() {
        if (document.getElementById('hero-photo-style')) return;
        var s = document.createElement('style');
        s.id = 'hero-photo-style';
        s.textContent = STYLE;
        document.head.appendChild(s);
    }

    function main(hero, config) {
        var cfg = window.SITE_CONFIG || {};
        var actor = cfg.actor || {};
        var nameEn = String(actor.nameEn || '');
        var name = String(actor.name || '');
        var tagline = String(actor.tagline || '');
        var tone = config.tone;

        /* 照片背景保留（桌面 .hero__media / 移动端 .hero__mobile 均为站点现成机制）；
           文字恢复站点原有 hero 文案 */
        var hint = hero.querySelector('.hero__scroll-hint');
        var oldContent = hero.querySelector('.hero__content');
        if (oldContent) oldContent.remove();

        hero.classList.add('hero--photo', tone === 'light' ? 'hw-tone-light' : 'hw-tone-dark');

        var shade = document.createElement('div');
        shade.className = 'hw-shade';
        var dust = document.createElement('canvas');
        dust.className = 'hw-dust';
        var grain = document.createElement('div');
        grain.className = 'hw-grain';
        var content = document.createElement('div');
        content.className = 'hw-content';
        content.innerHTML =
            '<p class="hw-eyebrow"></p>' +
            '<h1 class="hw-title"></h1>' +
            '<span class="hw-rule"></span>' +
            '<p class="hw-subtitle"></p>';
        hero.appendChild(shade);
        hero.appendChild(dust);
        hero.appendChild(grain);
        hero.appendChild(content);
        if (hint) hero.appendChild(hint);

        content.querySelector('.hw-eyebrow').textContent = nameEn;
        content.querySelector('.hw-title').textContent = name;
        content.querySelector('.hw-subtitle').textContent = tagline;
        if (!nameEn) content.querySelector('.hw-eyebrow').style.display = 'none';
        if (!tagline) content.querySelector('.hw-subtitle').style.display = 'none';

        /* ---------- 粒子系统（canvas 2D） ---------- */
        var ctx = dust.getContext('2d');
        var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        var parts = [];
        var W = 0, H = 0;
        var ACCENT = [0.976, 0.973, 0.965]; /* 站点原本米色 #f9f8f6 */

        function smoothstep(a, b, x) {
            var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
            return t * t * (3 - 2 * t);
        }
        function crestY(px) {
            var u = W > 0 ? px / W : 0;
            var yc = 0.14
                + 0.48 * Math.pow(smoothstep(0.34, 1, u), 1.7)
                - 0.06 * Math.exp(-Math.pow((u - 0.45) / 0.14, 2));
            return H * (1 - yc);
        }
        function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 0.8; }
        function warmWhite() { return [255, 248, 238]; }
        /* 明调：白芯 + 金/玫瑰色晕的发光珠（sprite）；暗调：暖白加色粒子 */
        function pColor() {
            if (tone === 'light') {
                var r = Math.random();
                if (r < 0.5) return { c: [1, 1, 1], k: 'white' };
                if (r < 0.78) return { c: [0.83, 0.62, 0.33], k: 'gold' };
                return { c: [0.76, 0.46, 0.47], k: 'rose' };
            }
            return { c: warmWhite(), k: 'white' };
        }
        var spriteCache = {};
        function makeSprite(core, mid, edge) {
            var c = document.createElement('canvas');
            c.width = c.height = 64;
            var g = c.getContext('2d');
            var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
            gr.addColorStop(0, core);
            gr.addColorStop(0.32, mid);
            gr.addColorStop(0.62, edge);
            gr.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = gr;
            g.fillRect(0, 0, 64, 64);
            return c;
        }
        function buildSprites() {
            spriteCache.white = makeSprite('rgba(255,255,255,0.92)', 'rgba(226,218,202,0.40)', 'rgba(208,198,182,0.10)');
            spriteCache.gold  = makeSprite('rgba(255,244,215,0.95)', 'rgba(201,143,55,0.78)', 'rgba(166,110,38,0.20)');
            spriteCache.rose  = makeSprite('rgba(255,238,238,0.95)', 'rgba(199,108,110,0.78)', 'rgba(168,90,93,0.20)');
        }
        buildSprites();

        function spawnDust(anywhere) {
            var col = pColor();
            return { kind: 0, x: Math.random() * W, y: anywhere ? Math.random() * H : H + 6,
                r: 0.5 + Math.random() * 1.1, vy: -(3 + Math.random() * 7), vx: 0,
                sway: Math.random() * 6.283, sw: 0.3 + Math.random() * 0.7,
                a: 0.08 + Math.random() * 0.16, tw: Math.random() * 6.283, tws: 0.5 + Math.random() * 1.2,
                c: col.c, k: col.k, depth: 4 };
        }
        function spawnCrest(anywhere) {
            var px, cy, tries = 0;
            do { px = Math.random() * W; cy = crestY(px); } while (cy > H + 30 && ++tries < 4);
            if (cy > H + 30) return spawnDust(anywhere);
            var m = (crestY(px + 3) - crestY(px - 3)) / 6;
            var len = Math.sqrt(1 + m * m);
            var s = 16 + Math.random() * 30;
            var col = pColor();
            return { kind: 1, x: px, y: anywhere ? Math.max(0, cy + gauss() * H * 0.055) : cy + gauss() * H * 0.055,
                r: 0.8 + Math.random() * 1.9,
                vx: s / len, vy: m * s / len - (2 + Math.random() * 5),
                sway: 0, sw: 0,
                a: 0.20 + Math.random() * 0.40, tw: Math.random() * 6.283, tws: 0.9 + Math.random() * 2.0,
                c: col.c, k: col.k, depth: 9, glint: Math.random() < 0.3 };
        }
        function spawnSparkle(anywhere) {
            var col = pColor();
            return { kind: 2, x: Math.random() * W, y: anywhere ? Math.random() * H : H + 6,
                r: 1.6 + Math.random() * 1.3, vy: -(18 + Math.random() * 14), vx: 0,
                sway: Math.random() * 6.283, sw: 0.5 + Math.random() * 0.9,
                a: 0.30 + Math.random() * 0.40, tw: Math.random() * 6.283, tws: 1.4 + Math.random() * 2.2,
                c: col.c, k: col.k, depth: 14, glint: true };
        }
        function spawnBokeh() {
            var col = pColor();
            return { kind: 3, x: Math.random() * W, y: Math.random() * H,
                r: 3.5 + Math.random() * 5, vy: -(2 + Math.random() * 4), vx: 0,
                sway: Math.random() * 6.283, sw: 0.2 + Math.random() * 0.4,
                a: 0.045 + Math.random() * 0.05, tw: Math.random() * 6.283, tws: 0.3 + Math.random() * 0.5,
                c: col.c, k: col.k, depth: 6 };
        }
        function build() {
            parts = [];
            var i;
            var dens = W < 768 ? 1.5 : 1; /* 窄屏提密度，保证聚形轮廓足够密 */
            var nField = Math.round(W * H / 9000 * dens);
            for (i = 0; i < nField; i++) parts.push(spawnDust(true));
            var nCrest = Math.round(W * H / 5200 * dens);
            for (i = 0; i < nCrest; i++) parts.push(spawnCrest(true));
            var nSpark = Math.round(W * H / 42000 * dens);
            for (i = 0; i < nSpark; i++) parts.push(spawnSparkle(true));
            var nBok = Math.max(4, Math.round(W * H / 160000 * dens));
            for (i = 0; i < nBok; i++) parts.push(spawnBokeh());
        }
        function resize() {
            var r = hero.getBoundingClientRect();
            W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
            dust.width = Math.round(W * dpr); dust.height = Math.round(H * dpr);
            dust.style.width = W + 'px'; dust.style.height = H + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            build();
        }
        resize();
        window.addEventListener('resize', resize);

        var hasHover = window.matchMedia && matchMedia('(hover: hover)').matches;
        var mx = 0, my = 0, cmx = 0, cmy = 0;
        if (hasHover && !reduced) {
            window.addEventListener('mousemove', function (e) {
                mx = (e.clientX / window.innerWidth - 0.5) * 2;
                my = (e.clientY / window.innerHeight - 0.5) * 2;
            });
        }

        /* ---------- 聚形槽位生成器（全部返回屏幕相对偏移 [dx,dy]，y 向下） ---------- */

        function sc(d, m) { return Math.min(W, H) * (W < 768 ? m : d); }

        /* 月牙：外圆减内圆轮廓，外弧 62% + 内弧 26% + 伴星 12%，微倾 */
        function moonSlots() {
            var s = sc(0.13, 0.22);
            var ix = 0.55 * s, ir = 0.85 * s;
            var rho = -0.18, cs = Math.cos(rho), sn = Math.sin(rho);
            var pts = [], i, ang, R, mx2, my2;
            var n1 = Math.round(parts.length * 0.62);
            for (i = 0; i < n1; i++) {
                ang = 1.01 + (5.27 - 1.01) * (n1 > 1 ? i / (n1 - 1) : 0.5);
                R = s * (1 + (Math.random() - 0.5) * 0.06);
                mx2 = Math.cos(ang) * R; my2 = Math.sin(ang) * R;
                pts.push([mx2 * cs - my2 * sn, -(mx2 * sn + my2 * cs)]);
            }
            var n2 = Math.round(parts.length * 0.26);
            for (i = 0; i < n2; i++) {
                ang = 1.60 + (4.68 - 1.60) * (n2 > 1 ? i / (n2 - 1) : 0.5);
                R = ir * (1 + (Math.random() - 0.5) * 0.05);
                mx2 = ix + Math.cos(ang) * R; my2 = Math.sin(ang) * R;
                pts.push([mx2 * cs - my2 * sn, -(mx2 * sn + my2 * cs)]);
            }
            var n3 = parts.length - n1 - n2;
            for (i = 0; i < n3; i++) {
                ang = Math.random() * 6.283;
                R = s * (1.3 + Math.random() * 0.9);
                mx2 = Math.cos(ang) * R; my2 = Math.sin(ang) * R;
                pts.push([mx2 * cs - my2 * sn, -(mx2 * sn + my2 * cs)]);
            }
            return pts;
        }

        /* 心形：经典参数曲线（数学坐标 y 向上，画布需翻转），轮廓 70% + 内部 30% */
        function heartSlots() {
            var s = sc(0.0085, 0.013);
            var pts = [], i, t, hx, hy;
            var n1 = Math.round(parts.length * 0.70);
            for (i = 0; i < n1; i++) {
                t = (i / n1) * 6.283;
                hx = 16 * Math.pow(Math.sin(t), 3);
                hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
                pts.push([hx * s + (Math.random() - 0.5) * 4, -(hy * s - 2.65 * s) + (Math.random() - 0.5) * 4]);
            }
            for (i = 0; i < parts.length - n1; i++) {
                t = Math.random() * 6.283;
                var q = 0.2 + 0.65 * Math.random();
                hx = 16 * Math.pow(Math.sin(t), 3) * q;
                hy = (-4 + (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 4) * q);
                pts.push([hx * s, -(hy * s) + 2.65 * s]);
            }
            return pts;
        }

        /* 沿闭合折线均匀取点 */
        function alongPolyline(poly, count) {
            var segs = [], total = 0, i;
            for (i = 0; i < poly.length; i++) {
                var a = poly[i], b = poly[(i + 1) % poly.length];
                var L = Math.hypot(b[0] - a[0], b[1] - a[1]);
                segs.push(L); total += L;
            }
            var pts = [];
            for (i = 0; i < count; i++) {
                var target = total * (i + Math.random() * 0.5) / count;
                var acc = 0, j = 0;
                while (j < segs.length - 1 && acc + segs[j] < target) { acc += segs[j]; j++; }
                var t = (target - acc) / (segs[j] || 1);
                var a2 = poly[j], b2 = poly[(j + 1) % poly.length];
                pts.push([a2[0] + (b2[0] - a2[0]) * t, a2[1] + (b2[1] - a2[1]) * t]);
            }
            return pts;
        }

        /* 五角星：十点星形多边形轮廓 88% + 周围伴星 12% */
        function starSlots() {
            var R = sc(0.115, 0.17);
            var poly = [], i;
            for (i = 0; i < 10; i++) {
                var ang = -Math.PI / 2 + i * Math.PI / 5;
                var rr = (i % 2 === 0) ? R : R * 0.42;
                poly.push([Math.cos(ang) * rr, Math.sin(ang) * rr]); /* 已是屏幕坐标（尖朝上） */
            }
            var pts = alongPolyline(poly, Math.round(parts.length * 0.88));
            var n3 = parts.length - pts.length;
            for (i = 0; i < n3; i++) {
                var ang2 = Math.random() * 6.283;
                var d = R * (1.25 + Math.random() * 0.75);
                pts.push([Math.cos(ang2) * d, Math.sin(ang2) * d]);
            }
            return pts;
        }

        /* 皇冠：折线轮廓 80% + 三个尖顶珠宝环 20% */
        function crownSlots() {
            var s = sc(0.10, 0.15);
            var poly = [
                [-0.85, 0.55], [-0.85, -0.05], [-0.55, -0.60], [-0.28, -0.05],
                [0, -0.68], [0.28, -0.05], [0.55, -0.60], [0.85, -0.05],
                [0.85, 0.55], [-0.85, 0.55]
            ].map(function (p) { return [p[0] * s, p[1] * s]; }); /* 屏幕 y 向下：尖朝上为负 */
            var pts = alongPolyline(poly, Math.round(parts.length * 0.80));
            var tips = [[-0.55, -0.60], [0, -0.68], [0.55, -0.60]];
            var n3 = parts.length - pts.length;
            for (var i = 0; i < n3; i++) {
                var tp = tips[i % tips.length];
                var ang = (i / n3) * 6.283;
                pts.push([tp[0] * s + Math.cos(ang) * 0.09 * s, tp[1] * s + Math.sin(ang) * 0.09 * s]);
            }
            return pts;
        }

        /* 花开：五瓣玫瑰线 r=R|cos(2.5θ)|，轮廓 75% + 花芯 15% + 花粉 10% */
        function flowerSlots() {
            var R = sc(0.115, 0.17);
            var pts = [], i;
            var n1 = Math.round(parts.length * 0.75);
            for (i = 0; i < n1; i++) {
                var t = (i / n1) * 6.283;
                var rr = R * Math.abs(Math.cos(2.5 * t));
                pts.push([Math.cos(t) * rr, Math.sin(t) * rr]);
            }
            var n2 = Math.round(parts.length * 0.15);
            for (i = 0; i < n2; i++) {
                var ang = Math.random() * 6.283;
                var d = Math.sqrt(Math.random()) * R * 0.16;
                pts.push([Math.cos(ang) * d, Math.sin(ang) * d]);
            }
            var n3 = parts.length - n1 - n2;
            for (i = 0; i < n3; i++) {
                var ang2 = Math.random() * 6.283;
                var d2 = R * (1.12 + Math.random() * 0.35);
                pts.push([Math.cos(ang2) * d2, Math.sin(ang2) * d2]);
            }
            return pts;
        }

        var SHAPE_FN = { moon: moonSlots, heart: heartSlots, star: starSlots, crown: crownSlots, flower: flowerSlots };
        var currentShape = config.shape;

        hero.addEventListener('click', function (e) {
            if (reduced) return;
            if (e.target.closest && e.target.closest('a, button')) return; /* 不干扰链接/按钮 */
            var r = hero.getBoundingClientRect();
            att = { x: e.clientX - r.left, y: e.clientY - r.top, t0: performance.now() };
            var shape = currentShape === 'random'
                ? SHAPE_LIST[Math.floor(Math.random() * SHAPE_LIST.length)]
                : currentShape;
            var pts = (SHAPE_FN[shape] || moonSlots)();
            for (var i = 0; i < parts.length; i++) {
                var pt = pts[i % pts.length];
                parts[i].hx = pt[0] + (Math.random() - 0.5) * 5;
                parts[i].hy = pt[1] + (Math.random() - 0.5) * 5;
                parts[i].kick = null;
            }
            pulses.push({ x: att.x, y: att.y, t0: att.t0 });
            if (pulses.length > 6) pulses.shift();
        });

        function attractState() {
            if (!att) return null;
            var e = (performance.now() - att.t0) / 1000;
            if (e >= GATHER + HOLD + RELEASE) { att = null; return null; }
            if (e < GATHER) return { phase: 'gather', k: e / GATHER, e: e };
            if (e < GATHER + HOLD) return { phase: 'hold', k: 1, e: e };
            return { phase: 'release', k: 1 - (e - GATHER - HOLD) / RELEASE, e: e };
        }

        var DEPTH = [5, 10, 16, 7];
        var flareMin = 0.85;

        function drawParticle(p, twk) {
            var ox = cmx * DEPTH[p.kind], oy = cmy * DEPTH[p.kind];
            var x = p.x + ox, y = p.y + oy;
            if (tone === 'light') {
                /* 明调：白芯色晕发光珠（sprite 贴图），星芒用深金 */
                var spr = spriteCache[p.k] || spriteCache.white;
                var R2 = p.r * (p.kind === 3 ? 2.6 : 3.3);
                ctx.globalAlpha = Math.min(1, p.a * twk * (p.kind === 3 ? 1.5 : 1.3));
                ctx.drawImage(spr, x - R2, y - R2, R2 * 2, R2 * 2);
                ctx.globalAlpha = 1;
                if (p.glint && twk > flareMin) {
                    var L2 = p.r * (5 + twk * 4);
                    ctx.strokeStyle = 'rgba(150,100,30,' + Math.min(0.55, (twk - flareMin) / (1.25 - flareMin) * 0.55).toFixed(3) + ')';
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(x - L2, y); ctx.lineTo(x + L2, y);
                    ctx.moveTo(x, y - L2); ctx.lineTo(x, y + L2);
                    ctx.stroke();
                }
                return;
            }
            if (p.kind === 3) {
                var g = ctx.createRadialGradient(x, y, 0, x, y, p.r);
                g.addColorStop(0, 'rgba(' + rgb(p.c) + ',' + (p.a * (0.7 + 0.3 * twk)).toFixed(3) + ')');
                g.addColorStop(1, 'rgba(' + rgb(p.c) + ',0)');
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.283); ctx.fill();
                return;
            }
            ctx.beginPath();
            ctx.fillStyle = 'rgba(' + rgb(p.c) + ',' + Math.min(1, p.a * twk).toFixed(3) + ')';
            ctx.arc(x, y, p.r, 0, 6.283);
            ctx.fill();
            if (p.glint && twk > flareMin) {
                var L = p.r * (5 + twk * 4);
                ctx.strokeStyle = 'rgba(' + rgb(p.c) + ',' + Math.min(0.55, (twk - flareMin) / (1.25 - flareMin) * 0.55).toFixed(3) + ')';
                ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.moveTo(x - L, y); ctx.lineTo(x + L, y);
                ctx.moveTo(x, y - L); ctx.lineTo(x, y + L);
                ctx.stroke();
            }
        }
        function rgb(c) { return Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255); }

        var GATHER = 1.0, HOLD = 0.85, RELEASE = 0.7;
        var att = null, pulses = [];

        function step(dt) {
            cmx += (mx - cmx) * Math.min(1, dt * 3);
            cmy += (my - cmy) * Math.min(1, dt * 3);
            ctx.clearRect(0, 0, W, H);
            ctx.globalCompositeOperation = tone === 'light' ? 'source-over' : 'lighter';
            var st = attractState();
            flareMin = st ? 1.0 : 0.85; /* 聚形期间抑制大星芒，避免冲垮轮廓 */
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i];
                p.tw += p.tws * dt;
                var nvx = 0, nvy = p.vy;
                if (p.kind === 1) { nvx = p.vx; nvy = p.vy; }
                else { p.sway += p.sw * dt; nvx = Math.sin(p.sway) * 5; }

                var boost = 1;
                if (st) {
                    var beat = 1;
                    if (st.phase === 'hold') {
                        var b = ((st.e - GATHER) * 1.15) % 1;
                        beat = 1 + 0.04 * (Math.exp(-Math.pow((b - 0.30) / 0.09, 2)));
                    }
                    if (st.phase !== 'release') {
                        var rate = Math.min(1, (2 + 9 * st.k) * dt);
                        p.x += (att.x + p.hx * beat - p.x) * rate;
                        p.y += (att.y + p.hy * beat - p.y) * rate;
                    } else {
                        if (!p.kick) {
                            var rdx = p.x - att.x, rdy = p.y - att.y;
                            var rd = Math.sqrt(rdx * rdx + rdy * rdy) || 1;
                            p.kick = { x: rdx / rd * (10 + Math.random() * 14), y: rdy / rd * (10 + Math.random() * 14) };
                        }
                        p.x += (nvx + p.kick.x * st.k) * dt;
                        p.y += (nvy + p.kick.y * st.k) * dt;
                    }
                    boost = 1.2;
                } else {
                    p.x += nvx * dt;
                    p.y += nvy * dt;
                    if (p.kind === 1) { if (p.x > W + 10 || p.y < -10) parts[i] = spawnCrest(false); }
                    else if (p.y < -12) parts[i] = spawnDust(false);
                }
                if (p.x < -12) p.x = W + 10; if (p.x > W + 12) p.x = -10;
                var twk = p.kind === 3 ? (0.6 + 0.4 * Math.sin(p.tw)) : (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(p.tw)));
                drawParticle(p, Math.min(1.25, twk * boost));
            }
            for (var j = pulses.length - 1; j >= 0; j--) {
                var pu = pulses[j];
                var pe = (performance.now() - pu.t0) / 1000;
                if (pe > 0.7) { pulses.splice(j, 1); continue; }
                var rc = tone === 'light' ? '150,110,68' : rgb(ACCENT);
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(' + rc + ',' + (0.30 * (1 - pe / 0.7)).toFixed(3) + ')';
                ctx.lineWidth = 1.4;
                ctx.arc(pu.x + cmx * 10, pu.y + cmy * 10, 8 + pe * 340, 0, 6.283);
                ctx.stroke();
            }
        }

        if (!reduced) {
            var last = performance.now();
            requestAnimationFrame(function loop(now) {
                if (!document.hidden) {
                    var dt = Math.min(0.05, (now - last) / 1000);
                    last = now;
                    step(dt);
                } else { last = now; }
                requestAnimationFrame(loop);
            });
        } else {
            step(0);
        }
    }

    /* 启动：等 DOM 与站点渲染完成（main.js 的 init 是 async） */
    var waited = 0;
    (function boot() {
        var cfg = readConfig();
        if (!cfg.enabled) return;                     /* 插件数据里关掉了开关 */
        var h = document.querySelector('.hero');
        if (!h) { if (++waited > 120) return; return setTimeout(boot, 50); }
        injectStyle();
        try { main(h, cfg); } catch (err) { /* 任何异常都不影响站点原有 hero */ }
    })();
})();
