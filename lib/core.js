/**
 * 后端核心工具：路径、配置读写、文件复制
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pluginLoader = require('../plugin-loader');

const ROOT = path.join(__dirname, '..');
const PATHS = {
    ROOT,
    SITE_DIR: path.join(ROOT, 'site'),
    ADMIN_DIR: path.join(ROOT, 'admin'),
    DATA_DIR: path.join(ROOT, 'data'),
    UPLOADS_DIR: path.join(ROOT, 'uploads'),
    THEMES_DIR: path.join(ROOT, 'themes'),
    PLUGINS_DIR: pluginLoader.PLUGINS_DIR,
    DIST_DIR: path.join(ROOT, 'dist'),
    CONFIG_PATH: path.join(ROOT, 'data', 'config.json')
};

function ensureDirs() {
    Object.values(PATHS).forEach(dir => {
        // CONFIG_PATH 是文件不是目录：老版本会误建 config.json/ 目录（Windows 全新环境实测，事故 16 续）
        if (typeof dir !== 'string' || dir === PATHS.CONFIG_PATH) return;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    // 自愈：清除老版本误建的空 config.json/ 目录（非空则抛错留给人工，绝不静默删数据）
    try {
        if (fs.existsSync(PATHS.CONFIG_PATH) && fs.statSync(PATHS.CONFIG_PATH).isDirectory()) {
            fs.rmdirSync(PATHS.CONFIG_PATH);
        }
    } catch (e) { /* 目录非空或已消失：readConfig 会给出明确错误 */ }
}

let __lastMigrationAddedIds = false;

function migrateConfig(config) {
    if (!config.configVersion) config.configVersion = 2;
    if (!config.actor && config.photographer) {
        config.actor = {
            name: config.photographer.name || '',
            nameEn: config.photographer.nameEn || '',
            tagline: config.photographer.tagline || '',
            title: config.about && config.about.role || '',
            bio: config.about && config.about.bio || [],
            stats: config.about && config.about.stats || [],
            avatar: config.aboutImage || ''
        };
    }
    if (!config.actor) config.actor = { name: '', nameEn: '', tagline: '', title: '', bio: [], stats: [], avatar: '' };
    if (!config.hero) config.hero = { image: '', scrollHint: '' };
    if (!config.works) config.works = { heading: '代表作品', items: [] };

    // 旧版 works.items 按 type 分组为 categories
    if ((!config.works.categories || !Array.isArray(config.works.categories) || config.works.categories.length === 0) && Array.isArray(config.works.items)) {
        const catMap = {};
        const categories = [];
        config.works.items.forEach(item => {
            const name = item.type || '未分类';
            if (!catMap[name]) {
                catMap[name] = { name, items: [] };
                categories.push(catMap[name]);
            }
            catMap[name].items.push(item);
        });
        config.works.categories = categories;
        delete config.works.items;
    }
    if (!config.works.categories || !Array.isArray(config.works.categories)) config.works.categories = [];

    // 合并同名分类
    if (config.works.categories.length) {
        const catMap = {};
        const mergedCats = [];
        config.works.categories.forEach(cat => {
            const name = (cat.name || '未分类').trim();
            if (!catMap[name]) {
                catMap[name] = { name, items: [] };
                mergedCats.push(catMap[name]);
            }
            catMap[name].items.push(...(cat.items || []));
        });
        config.works.categories = mergedCats;
    }

    // 写真集迁移
    if (!config.gallery) config.gallery = { heading: '写真', albums: [] };
    if (!Array.isArray(config.gallery.albums)) config.gallery.albums = [];
    if (config.gallery.albums.length === 0 && Array.isArray(config.modules)) {
        const imagesMod = config.modules.find(m => m.type === 'images');
        if (imagesMod && Array.isArray(imagesMod.images) && imagesMod.images.length) {
            config.gallery.albums.push({
                title: imagesMod.label || '写真',
                cover: imagesMod.images[0],
                images: imagesMod.images.slice()
            });
        }
    }

    if (!config.about) config.about = { visible: true, heading: '关于演员', bio: [], stats: [], image: '' };
    if (!config.social) config.social = { links: [] };
    if (!config.footer) config.footer = { copyright: '' };
    // 版权链接：可配置多条（{text,url}）；固定条 ©杉果派（末位，后台只读不可删，导出/渲染均保证存在）
    if (!Array.isArray(config.footer.links)) config.footer.links = [];
    const FIXED_FOOTER_LINK = { text: '©杉果派', url: 'https://v.douyin.com/KJbd9GVc17Q/' };
    config.footer.links = config.footer.links.filter(l => !(l && l.text === FIXED_FOOTER_LINK.text && l.url === FIXED_FOOTER_LINK.url));
    config.footer.links.push(FIXED_FOOTER_LINK);
    // 制作组：点击页脚固定条「©杉果派」弹出成员名单（title 弹窗标题可配置；{name,role,link}，link 为成员主页可选）
    if (!config.footer.credits || typeof config.footer.credits !== 'object') config.footer.credits = { title: '制作组', members: [] };
    if (typeof config.footer.credits.title !== 'string' || !config.footer.credits.title.trim()) config.footer.credits.title = '制作组';
    if (!Array.isArray(config.footer.credits.members)) config.footer.credits.members = [];
    // 稳定 ID：为内容实体补发（老数据自愈）。删除/重排不再引起评论与深链错乱
    let idsAdded = false;
    const ensureId = (obj, prefix) => {
        if (obj && !obj.id) { obj.id = prefix + '-' + crypto.randomBytes(4).toString('base64url'); idsAdded = true; }
    };
    (config.works.categories || []).forEach(cat => (cat.items || []).forEach(it => ensureId(it, 'w')));
    (config.gallery.albums || []).forEach(a => ensureId(a, 'a'));
    const pd = (config.plugins && config.plugins.data) || {};
    ((pd['actor-news'] || {}).items || []).forEach(it => ensureId(it, 'n'));
    ((pd['actor-awards'] || {}).items || []).forEach(it => ensureId(it, 'aw'));
    ((pd['actor-schedule'] || {}).items || []).forEach(it => ensureId(it, 'sc'));
    ((pd['actor-schedule'] || {}).announcements || []).forEach(it => ensureId(it, 'an'));

    if (!config.modules || !Array.isArray(config.modules) || config.modules.length === 0) {
        config.modules = [
            { type: 'hero', visible: true },
            { type: 'about', visible: true },
            { type: 'works', visible: true },
            { type: 'footer', visible: true }
        ];
    }
    if (!config.plugins) config.plugins = { enabled: [], data: {} };
    if (!config.plugins.data) config.plugins.data = {};
    if (!config.plugins.enabled) config.plugins.enabled = [];
    if (!config.theme) config.theme = { active: null };
    if (typeof config.theme === 'string') config.theme = { active: config.theme };
    delete config.__idsAdded; // 清理可能被写入的遗留标记
    __lastMigrationAddedIds = idsAdded; // 模块级标记：供 readConfig 自愈落盘判断
    return config;
}

/** 全新环境播种用默认配置：migrateConfig 不兜底的键（gallery/social/footer/about）在此给全结构 */
const DEFAULT_CONFIG = {
    configVersion: 2,
    actor: { name: '', nameEn: '', tagline: '', title: '', bio: [], stats: [], avatar: '' },
    hero: { mode: 'classic', image: '' },
    works: { heading: '代表作品', categories: [] },
    gallery: { heading: '写真', albums: [] },
    about: { heading: '', content: '', bio: [] },
    social: { links: [] },
    footer: { copyright: '', disclaimer: '', links: [], credits: { title: '制作组', members: [] } },
    modules: [
        { type: 'hero', visible: true },
        { type: 'about', visible: true },
        { type: 'works', visible: true },
        { type: 'images', visible: true },
        { type: 'news', visible: true },
        { type: 'awards', visible: true },
        { type: 'schedule', visible: true },
        { type: 'footer', visible: true }
    ],
    plugins: { enabled: [], data: {} },
    theme: { active: null },
    comments: {},
    exportReadme: ''
};

function readConfig() {
    // 全新环境自举：data/config.json 不存在时播种默认配置并落盘。
    // 此前直接 ENOENT 500，后台会把错误响应当配置对象，保存时连锁崩溃（Windows 全新 clone 实测）
    if (fs.existsSync(PATHS.CONFIG_PATH) && fs.statSync(PATHS.CONFIG_PATH).isDirectory()) {
        try {
            fs.rmdirSync(PATHS.CONFIG_PATH); // 空目录（老 ensureDirs 误建）直接清；非空会抛错
        } catch (e) {
            throw new Error('data/config.json 是一个非空目录（历史遗留），请手动删除该文件夹后重启');
        }
    }
    if (!fs.existsSync(PATHS.CONFIG_PATH)) {
        const seeded = migrateConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
        try {
            fs.mkdirSync(path.dirname(PATHS.CONFIG_PATH), { recursive: true }); // data/ 目录在全新环境同样不存在
        } catch (e) { /* 已存在 */ }
        try {
            fs.writeFileSync(PATHS.CONFIG_PATH, JSON.stringify(seeded, null, 4), 'utf-8');
        } catch (e) { /* 只读盘等场景：返回内存版 */ }
        const state = pluginLoader.getState();
        seeded.plugins.enabled = Array.isArray(state.enabled) ? state.enabled.slice() : [];
        return seeded;
    }
    const config = JSON.parse(fs.readFileSync(PATHS.CONFIG_PATH, 'utf-8'));
    migrateConfig(config);
    if (__lastMigrationAddedIds) {
        // 稳定 ID 补发后立即落盘：避免两次读取生成不同 ID（导出/运行时不一致）
        try { fs.writeFileSync(PATHS.CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8'); } catch (e) { /* 只读场景静默 */ }
    }
    const state = pluginLoader.getState();
    config.plugins.enabled = Array.isArray(state.enabled) ? state.enabled.slice() : [];
    return config;
}

function writeConfig(config) {
    migrateConfig(config);
    fs.writeFileSync(PATHS.CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');
}

/** 密钥字段黑名单：导出 dist 时递归擦除（防 token/key/cookie 泄漏到静态站） */const SENSITIVE_KEYS = /^(token|secret$|secretaccesskey|accesskeyid|llmkey|cookie|password|passwd|apikey|api_key|accountid|privatekey)$/i;

/** 需要导出到静态站的内容型插件白名单（其余插件数据均为服务端私有配置，一概不导出）
 *  hero-pet：前端需读取其显示配置（尺寸/速度/开关），故一并导出 */
const EXPORTABLE_PLUGIN_DATA = ['actor-news', 'actor-awards', 'actor-schedule', 'hero-pet'];

/** 与静态网页无关的顶层字段（服务端私有；plugins 需保留用于内容数据白名单过滤） */
const STRIP_TOP_KEYS = /^(theme|exportReadme)$/;

function deepStripSecrets(node) {
    if (Array.isArray(node)) {
        node.forEach(deepStripSecrets);
        return node;
    }
    if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) {
            if (SENSITIVE_KEYS.test(k)) {
                delete node[k];
            } else {
                deepStripSecrets(node[k]);
            }
        }
    }
    return node;
}

/**
 * 导出到静态站的配置：只保留网页渲染所需数据。
 * - 顶层：演员/首页/作品/写真/关于/社交/页脚/模块等；删除 plugins、theme、exportReadme
 * - 插件数据：仅保留内容型插件（actor-news/awards/schedule），其余插件配置整段不导出
 * - 兜底：递归擦除密钥字段
 */
function sanitizeConfigForExport(config) {
    const clone = JSON.parse(JSON.stringify(config));
    for (const k of Object.keys(clone)) {
        if (STRIP_TOP_KEYS.test(k)) delete clone[k];
    }
    if (clone.plugins && clone.plugins.data) {
        const keep = {};
        EXPORTABLE_PLUGIN_DATA.forEach(n => {
            if (clone.plugins.data[n] !== undefined) keep[n] = clone.plugins.data[n];
        });
        clone.plugins = { data: keep };
    }
    return deepStripSecrets(clone);
}

function generateConfigJs(config) {
    return `/**\n * Auto-generated by Actor Home CMS\n * ${new Date().toISOString()}\n */\nvar SITE_CONFIG = ${JSON.stringify(config, null, 4)};\n`;
}

/** data-gallery.js 内容：图集数据（从主 config 拆出，前台按需懒加载，避免每页都背 300KB+）
 *  形状与 SITE_CONFIG.gallery 完全一致，加载后直接覆盖同名键。 */
function generateGalleryJs(config) {
    const g = (config && config.gallery) || { heading: '写真', albums: [] };
    return 'window.SITE_CONFIG = window.SITE_CONFIG || {};\n'
        + 'window.SITE_CONFIG.gallery = ' + JSON.stringify(g, null, 4) + ';\n';
}

/** 主 config 用：剥掉体量最大的 gallery.albums（保留 heading 等轻量字段） */
function stripGallery(cfg) {
    const clone = JSON.parse(JSON.stringify(cfg || {}));
    if (clone.gallery && typeof clone.gallery === 'object') delete clone.gallery.albums;
    return clone;
}

/** data-comments.js 内容：评论数据 + 评论功能总开关（导出与「一键启停」即时重写共用同一口径） */
function generateCommentsJs(config) {
    const enabled = !(config.commentSettings && config.commentSettings.enabled === false);
    return 'window.SITE_CONFIG = window.SITE_CONFIG || {};\nwindow.SITE_CONFIG.comments = ' + JSON.stringify(config.comments || {}, null, 4) + ';\n'
        + 'window.SITE_CONFIG.commentsEnabled = ' + (enabled ? 'true' : 'false') + ';\n';
}

function copyDirSync(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
    }
}

function copyDirFiltered(srcDir, destDir, allowed) {
    if (!fs.existsSync(srcDir)) return;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    for (const name of allowed) {
        const srcPath = path.join(srcDir, name);
        if (!fs.existsSync(srcPath)) continue;
        const destPath = path.join(destDir, name);
        if (fs.statSync(srcPath).isDirectory()) copyDirSync(srcPath, destPath);
        else {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/* ===================================================================
   插件前端脚本（通用钩子）
   插件若在 manifest 声明 client 且设 "inject": true，其脚本会被注入到
   每个 HTML 页面。NAS 实时站由 lib/routes/site.js 注入，公共站由导出
   写入 dist 后注入。
   显式 opt-in 的原因：仅声明 client 的插件（占位 client.js 避免 404）
   不应被静默激活，否则会给每页引入无谓请求与未验证的代码路径。
   注入点紧跟 cms.js 之后：保证插件在页面渲染脚本之前调用 CMS.registerModule。
   =================================================================== */

/** manifest 内相对路径安全化：禁止绝对路径与 .. 上跳（防越权读文件/拷贝） */
function safeRelPath(p) {
    const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!s || s.split('/').includes('..')) return '';
    return s;
}

/** 已启用、声明 client 且显式 inject:true 的插件：[{ name, client, assets, src }] */
function listEnabledPluginClients() {
    try {
        const state = JSON.parse(fs.readFileSync(path.join(PATHS.DATA_DIR, 'plugins.json'), 'utf-8'));
        const enabled = Array.isArray(state.enabled) ? state.enabled : [];
        const out = [];
        for (const name of enabled) {
            if (!/^[a-zA-Z0-9_\-]+$/.test(name)) continue;
            const dir = path.join(PATHS.PLUGINS_DIR, name);
            let mf;
            try { mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')); } catch (e) { continue; }
            if (!mf || mf.inject !== true) continue; // 仅显式 opt-in 的前端脚本才注入
            const client = safeRelPath(mf && mf.client);
            if (!client || !fs.existsSync(path.join(dir, client))) continue;
            out.push({
                name,
                client,
                assets: (Array.isArray(mf.assets) ? mf.assets : []).map(safeRelPath).filter(Boolean),
                src: '/plugins/' + name + '/' + client
            });
        }
        return out;
    } catch (e) {
        return [];
    }
}

/** 把已启用插件的 client.js <script> 注入 HTML 字符串 */
function injectPluginClientTags(html) {
    const list = listEnabledPluginClients();
    if (!list.length || typeof html !== 'string') return html;
    const tags = list.map(c => `<script src="${c.src}"></script>`).join('\n    ');
    const anchor = '<script src="/js/cms.js"></script>';
    if (html.includes(anchor)) return html.replace(anchor, anchor + '\n    ' + tags);
    if (html.includes('</head>')) return html.replace('</head>', '    ' + tags + '\n</head>');
    return html.replace(/<\/body>/i, tags + '\n</body>');
}

/** 导出插件前端资源：仅拷 client.js 与 manifest.assets 到 dist/plugins/<name>/（绝不拷贝 server.js，防泄漏） */
function exportPluginClients(distDir) {
    const list = listEnabledPluginClients();
    for (const c of list) {
        try {
            const srcDir = path.join(PATHS.PLUGINS_DIR, c.name);
            const dstDir = path.join(distDir, 'plugins', c.name);
            const clientDst = path.join(dstDir, c.client);
            fs.mkdirSync(path.dirname(clientDst), { recursive: true });
            fs.copyFileSync(path.join(srcDir, c.client), clientDst);
            if (c.assets.length) copyDirFiltered(srcDir, dstDir, c.assets);
        } catch (e) { /* 单插件失败不阻断导出 */ }
    }
    return list;
}

/** 对目录根下所有 HTML 注入插件 client 标签，返回改动文件数 */
function injectPluginClientsInDir(dir) {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.html?$/i.test(entry.name)) continue;
        const p = path.join(dir, entry.name);
        const html = fs.readFileSync(p, 'utf-8');
        const next = injectPluginClientTags(html);
        if (next !== html) { fs.writeFileSync(p, next, 'utf-8'); n++; }
    }
    return n;
}

module.exports = {
    PATHS,
    ensureDirs,
    migrateConfig,
    readConfig,
    writeConfig,
    sanitizeConfigForExport,
    generateConfigJs,
    generateCommentsJs,
    generateGalleryJs,
    stripGallery,
    copyDirSync,
    copyDirFiltered,
    listEnabledPluginClients,
    injectPluginClientTags,
    exportPluginClients,
    injectPluginClientsInDir
};
