/**
 * 后端核心工具：路径、配置读写、文件复制
 */
const fs = require('fs');
const path = require('path');
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
        if (typeof dir === 'string' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
}

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
    return config;
}

function readConfig() {
    const config = JSON.parse(fs.readFileSync(PATHS.CONFIG_PATH, 'utf-8'));
    migrateConfig(config);
    const state = pluginLoader.getState();
    config.plugins.enabled = Array.isArray(state.enabled) ? state.enabled.slice() : [];
    return config;
}

function writeConfig(config) {
    migrateConfig(config);
    fs.writeFileSync(PATHS.CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');
}

/** 密钥字段黑名单：导出 dist 时递归擦除（防 token/key/cookie 泄漏到静态站） */
const SENSITIVE_KEYS = /^(token|secret$|secretaccesskey|accesskeyid|llmkey|cookie|password|passwd|apikey|api_key|accountid|privatekey)$/i;

/** 需要导出到静态站的内容型插件白名单（其余插件数据均为服务端私有配置，一概不导出） */
const EXPORTABLE_PLUGIN_DATA = ['actor-news', 'actor-awards', 'actor-schedule'];

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

module.exports = {
    PATHS,
    ensureDirs,
    migrateConfig,
    readConfig,
    writeConfig,
    sanitizeConfigForExport,
    generateConfigJs,
    copyDirSync,
    copyDirFiltered
};
