/**
 * 静态导出路由
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// 公共站正式域名（sitemap / OG / canonical 使用），换域名只改这里
const SITE_URL = 'https://www.qmqmqq.love';

/** SEO 元信息：按页生成标题/描述，注入 OG 与 canonical，产出 robots.txt 和 sitemap.xml。
 * dist 每次从 site/ 全新拷贝后再改写，不会累积重复标签。 */
function seoMeta(distDir, config) {
    const escA = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const actor = config.actor || {};
    const name = actor.name || '演员主页';
    const nameEn = actor.nameEn || '';
    const tagline = actor.tagline || actor.title || '';
    const albums = (config.gallery && Array.isArray(config.gallery.albums)) ? config.gallery.albums : [];
    const worksCount = ((config.works && config.works.categories) || [])
        .reduce((n, c) => n + ((c.items || []).length), 0);
    const imgCount = albums.reduce((n, a) => n + ((a.images || []).length), 0);
    const ogImage = (config.hero && config.hero.image) || actor.cover
        || (albums[0] && (albums[0].cover || (albums[0].images || [])[0])) || '';
    const siteDesc = [String(tagline).replace(/[。.]\s*$/, ''), `收录 ${worksCount} 部影视作品、${albums.length} 个写真集（共 ${imgCount} 张照片）与最新动态，持续更新。`]
        .filter(Boolean).join('。');

    const pages = {
        'index.html': { title: `${name} ${nameEn}｜个人资料 · 代表作品 · 写真集`, desc: siteDesc },
        'about.html': { title: `${name}的个人资料`, desc: `演员${name}的个人简介与基本信息。` },
        'works.html': { title: `${name}的代表作品`, desc: `收录演员${name}的 ${worksCount} 部影视作品（电视剧/短剧/电影/影游）与剧照。` },
        'gallery.html': { title: `${name}的写真集`, desc: `收录演员${name}的 ${albums.length} 个写真集、共 ${imgCount} 张高清照片，持续更新。` },
        'news.html': { title: `${name}的最新动态`, desc: `演员${name}的最新资讯与动态，持续更新。` },
        'awards.html': { title: `${name}的荣誉奖项`, desc: `演员${name}获得的荣誉奖项一览。` },
        'schedule.html': { title: `${name}的近期行程`, desc: `演员${name}的近期活动行程安排。` }
    };

    for (const [file, meta] of Object.entries(pages)) {
        const p = path.join(distDir, file);
        if (!fs.existsSync(p)) continue;
        let html = fs.readFileSync(p, 'utf-8');
        const url = SITE_URL + (file === 'index.html' ? '/' : '/' + file);
        html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escA(meta.title)}</title>`);
        const descTag = `<meta name="description" content="${escA(meta.desc)}">`;
        if (/<meta name="description"/i.test(html)) {
            html = html.replace(/<meta name="description"[^>]*>/i, descTag);
        } else {
            html = html.replace(/<\/title>/, `</title>\n    ${descTag}`);
        }
        const head = [
            `<meta property="og:title" content="${escA(meta.title)}">`,
            `<meta property="og:description" content="${escA(meta.desc)}">`,
            `<meta property="og:type" content="website">`,
            `<meta property="og:url" content="${url}">`,
            `<meta property="og:site_name" content="${escA(name)}应援站">`,
            ogImage ? `<meta property="og:image" content="${escA(ogImage)}">` : '',
            `<link rel="canonical" href="${url}">`
        ].filter(Boolean).join('\n    ');
        html = html.replace('</head>', `    ${head}\n</head>`);
        fs.writeFileSync(p, html, 'utf-8');
    }

    fs.writeFileSync(path.join(distDir, 'robots.txt'),
        `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'utf-8');

    const today = new Date().toISOString().slice(0, 10);
    const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        Object.keys(pages).map(f => {
            const loc = SITE_URL + (f === 'index.html' ? '/' : '/' + f);
            return `  <url><loc>${loc}</loc><lastmod>${today}</lastmod></url>`;
        }).join('\n') + '\n</urlset>\n';
    fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap, 'utf-8');
}

module.exports = function createExportRoutes(core) {
    const router = express.Router();
    const { PATHS, readConfig, sanitizeConfigForExport, generateConfigJs, generateCommentsJs, generateGalleryJs, stripGallery, copyDirSync, exportPluginClients, injectPluginClientsInDir } = core;

    /** 懒加载 terser：未安装时导出降级为不压缩（不阻断流程） */
    let terserMod = null;
    let terserTried = false;
    function getTerser() {
        if (!terserTried) {
            terserTried = true;
            try { terserMod = require('terser'); } catch (e) { terserMod = null; }
        }
        return terserMod;
    }

    /** 递归收集目录下所有 .js 文件（相对路径） */
    function collectJsFiles(dir, base = dir, out = []) {
        if (!fs.existsSync(dir)) return out;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) collectJsFiles(full, base, out);
            else if (entry.name.endsWith('.js')) out.push(full);
        }
        return out;
    }

    /**
     * 压缩 dist 内所有 JS（含 js/ 业务脚本与 functions/ Pages Function）：
     * 去注释 + 压空白 + 缩短局部变量名，保留对外全局名与 Function 入口名。
     * functions/ 是 ESM，mangle 必须保留 onRequestPost/onRequest* 导出名（Cloudflare 按名调用）。
     */
    async function minifyDistJs(distDir) {
        const terser = getTerser();
        if (!terser) return { ok: false, reason: 'terser 未安装（跳过压缩）' };
        const RESERVED = [
            'SITE_CONFIG', 'CMS', 'Comments', 'ContributePage', 'PAGE_TYPE', 'COMMENTS_ENDPOINT',
            'onRequestPost', 'onRequestGet', 'onRequest', 'onRequestOptions' // Pages Function 入口（按名调用，不可混淆）
        ];
        let count = 0, before = 0, after = 0, failed = [];
        for (const file of collectJsFiles(distDir)) {
            const src = fs.readFileSync(file, 'utf-8');
            const rel = path.relative(distDir, file);
            try {
                const isEsm = rel.startsWith('functions' + path.sep);
                const out = await terser.minify(src, {
                    // ESM 必须 module:true；⚠️ 不可设 mangle.toplevel:false——那是 CJS 写法，
                    // 会干扰 ESM 导出处理导致 export 语句被剥离（Pages Function 会直接失效）
                    module: isEsm,
                    compress: { drop_console: false, drop_debugger: true, passes: 2 },
                    mangle: isEsm ? { reserved: RESERVED } : { reserved: RESERVED, toplevel: false },
                    format: { comments: false }
                });
                if (!out || typeof out.code !== 'string' || !out.code.length) throw new Error('空输出');
                if (out.code.length > src.length) throw new Error('输出反而更大');
                // ESM 入口必须保留导出与入口函数名（terser 可能输出 export{} 或 export async function）
                if (isEsm) {
                    if (!/\bexport\b/.test(out.code)) throw new Error('导出被破坏（缺少 export）');
                    if (!/onRequest/.test(out.code)) throw new Error('入口函数名丢失（onRequest*）');
                }
                fs.writeFileSync(file, out.code, 'utf-8');
                before += src.length; after += out.code.length; count++;
            } catch (e) {
                failed.push(rel + ': ' + e.message); // 单文件失败保留原文件
            }
        }
        return { ok: true, files: count, before, after, failed };
    }

    // 静态导出只包含原始 HTML/JS/CSS，不导出插件资源
    router.post('/api/export', async (req, res) => {
        try {
            // 清空 dist 目录内容，但保留挂载点本身（Docker volume 不能删除根目录）
            if (fs.existsSync(PATHS.DIST_DIR)) {
                for (const entry of fs.readdirSync(PATHS.DIST_DIR)) {
                    fs.rmSync(path.join(PATHS.DIST_DIR, entry), { recursive: true, force: true });
                }
            } else {
                fs.mkdirSync(PATHS.DIST_DIR, { recursive: true });
            }

            copyDirSync(PATHS.SITE_DIR, PATHS.DIST_DIR);

            const config = readConfig();
            // 写入 GitHub Issues 提交模板（优先使用后台自定义内容）
            const defaultReadme = require('../issue-readme');
            const readmeContent = config.exportReadme || defaultReadme;
            fs.writeFileSync(path.join(PATHS.DIST_DIR, 'README.md'), readmeContent);
            const jsDir = path.join(PATHS.DIST_DIR, 'js');
            fs.mkdirSync(jsDir, { recursive: true });
            // 主 config 剥离评论与图集：评论→data-comments.js、图集→data-gallery.js
            // （dist 与 site/js 双写，后者供 NAS 实时站；两者均按需懒加载）
            const exportConfig = sanitizeConfigForExport(config);
            delete exportConfig.comments;
            fs.writeFileSync(path.join(jsDir, 'config.js'), generateConfigJs(stripGallery(exportConfig)), 'utf-8');
            const commentsJs = generateCommentsJs(config);
            fs.writeFileSync(path.join(jsDir, 'data-comments.js'), commentsJs, 'utf-8');
            const galleryJs = generateGalleryJs({ gallery: exportConfig.gallery });
            fs.writeFileSync(path.join(jsDir, 'data-gallery.js'), galleryJs, 'utf-8');
            const siteJsDir = path.join(PATHS.SITE_DIR, 'js');
            fs.mkdirSync(siteJsDir, { recursive: true });
            fs.writeFileSync(path.join(siteJsDir, 'data-comments.js'), commentsJs, 'utf-8');
            fs.writeFileSync(path.join(siteJsDir, 'data-gallery.js'), galleryJs, 'utf-8');

            if (config.hero && config.hero.image) {
                const indexPath = path.join(PATHS.DIST_DIR, 'index.html');
                if (fs.existsSync(indexPath)) {
                    let html = fs.readFileSync(indexPath, 'utf-8');
                    const preload = `<link rel="preload" as="image" href="${config.hero.image}">`;
                    html = html.replace('</head>', `    ${preload}\n</head>`);
                    fs.writeFileSync(indexPath, html, 'utf-8');
                }
            }

            // SEO：按页生成标题/描述/OG/canonical + robots.txt + sitemap.xml
            seoMeta(PATHS.DIST_DIR, config);

            if (fs.existsSync(PATHS.UPLOADS_DIR) && fs.readdirSync(PATHS.UPLOADS_DIR).length) {
                copyDirSync(PATHS.UPLOADS_DIR, path.join(PATHS.DIST_DIR, 'uploads'));
            }

            if (config.theme && config.theme.active) {
                const themePath = path.join(PATHS.THEMES_DIR, config.theme.active);
                if (fs.existsSync(themePath)) copyDirSync(themePath, PATHS.DIST_DIR);
            }

            // 调用已加载插件的 onExport 钩子
            for (const p of req.app.locals.loadedPlugins || []) {
                if (typeof p.ctx.onExport === 'function') {
                    try { p.ctx.onExport(PATHS.DIST_DIR); } catch (e) {
                        console.error('[export] plugin hook error', p.name, e);
                    }
                }
            }

            // 插件前端脚本：拷贝已启用插件的 client/assets 到 dist/plugins/，并注入各页 HTML
            // （只拷 client 与声明的 assets，绝不拷贝 server.js；注入点紧跟 cms.js）
            try {
                const clients = exportPluginClients(PATHS.DIST_DIR);
                const injected = injectPluginClientsInDir(PATHS.DIST_DIR);
                if (clients.length) console.log(`[export] 插件前端：${clients.map(c => c.name).join(', ')}（注入 ${injected} 个页面）`);
            } catch (e) {
                console.error('[export] 插件前端注入失败：', e.message);
            }

            // 最后一步：压缩 dist 内全部 JS（去注释 + 压空白 + 局部变量缩短）
            // 放在所有文件写入（含主题覆盖、插件钩子）之后，确保压缩结果就是最终产物
            const mini = await minifyDistJs(PATHS.DIST_DIR);
            if (mini.ok) {
                const saved = mini.before ? Math.round((1 - mini.after / mini.before) * 100) : 0;
                console.log(`[export] JS 压缩：${mini.files} 个文件，${(mini.before / 1024).toFixed(0)}KB → ${(mini.after / 1024).toFixed(0)}KB（-${saved}%）` + (mini.failed.length ? `，失败 ${mini.failed.length}` : ''));
            } else {
                console.warn('[export] JS 压缩跳过：' + mini.reason);
            }

            res.json({ success: true, path: PATHS.DIST_DIR });
        } catch (err) {
            res.status(500).json({ error: 'Export failed: ' + err.message });
        }
    });

    router.get('/api/export/download', (req, res) => {
        if (!fs.existsSync(PATHS.DIST_DIR)) {
            return res.status(404).json({ error: 'Export not found. Run export first.' });
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=actor-home.zip');
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', err => {
            if (!res.headersSent) res.status(500).json({ error: err.message });
        });
        archive.pipe(res);
        archive.directory(PATHS.DIST_DIR, false);
        archive.finalize();
    });

    return router;
};
