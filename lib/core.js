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

function sanitizeConfigForExport(config) {
    const clone = JSON.parse(JSON.stringify(config));
    if (clone.plugins && clone.plugins.data) {
        Object.keys(clone.plugins.data).forEach(pluginName => {
            const data = clone.plugins.data[pluginName];
            if (data && typeof data === 'object') delete data.token;
        });
    }
    return clone;
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
