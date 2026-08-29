/**
 * Plugin Loader
 * 负责扫描、校验、加载、卸载插件，并提供生命周期钩子。
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const DATA_DIR = path.join(ROOT, 'data');
const PLUGIN_STATE_PATH = path.join(DATA_DIR, 'plugins.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

/* ---------------- 状态管理 ---------------- */

function getState() {
    try {
        const state = JSON.parse(fs.readFileSync(PLUGIN_STATE_PATH, 'utf-8'));
        return {
            installed: Array.isArray(state.installed) ? state.installed : [],
            enabled: Array.isArray(state.enabled) ? state.enabled : []
        };
    } catch (e) {
        return { installed: [], enabled: [] };
    }
}

function saveState(state) {
    fs.writeFileSync(PLUGIN_STATE_PATH, JSON.stringify({
        installed: state.installed || [],
        enabled: state.enabled || []
    }, null, 4), 'utf-8');
}

/* ---------------- Manifest ---------------- */

function readManifest(pluginDirName) {
    const manifestPath = path.join(PLUGINS_DIR, pluginDirName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (e) {
        return { __invalid: true, error: 'manifest.json 不是合法 JSON' };
    }
}

function validateManifest(manifest) {
    if (!manifest || manifest.__invalid) return false;
    if (!manifest.name || !manifest.label || !manifest.version) return false;
    return true;
}

function safePluginPath(name) {
    return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

/* ---------------- 扫描 ---------------- */

function scanPlugins() {
    const state = getState();
    if (!fs.existsSync(PLUGINS_DIR)) return [];

    return fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
            const name = d.name;
            const manifest = readManifest(name);
            if (!validateManifest(manifest)) {
                console.warn(`[plugin-loader] 跳过插件 ${name}：manifest 无效`);
                return null;
            }
            return {
                name,
                manifest,
                enabled: state.enabled.includes(name),
                installed: state.installed.includes(name),
                paths: {
                    client: manifest.client ? path.join(name, manifest.client) : null,
                    server: manifest.server ? path.join(name, manifest.server) : null,
                    admin: manifest.admin ? path.join(name, manifest.admin) : null,
                    assets: manifest.assets || []
                }
            };
        })
        .filter(Boolean);
}

/* ---------------- 数据 ---------------- */

function getPluginData(name) {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        return (config.plugins && config.plugins.data && config.plugins.data[name]) || {};
    } catch (e) {
        return {};
    }
}

function setPluginData(name, data) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (!config.plugins) config.plugins = { enabled: [], data: {} };
    if (!config.plugins.data) config.plugins.data = {};
    config.plugins.data[name] = data || {};
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');
    return data;
}

/* ---------------- 加载 ---------------- */

function loadEnabledPlugins(app) {
    const plugins = scanPlugins().filter(p => p.enabled);
    const loaded = [];

    for (const plugin of plugins) {
        const serverPath = path.join(PLUGINS_DIR, plugin.name, plugin.manifest.server || 'server.js');
        if (!fs.existsSync(serverPath)) continue;

        try {
            const mod = require(serverPath);
            const ctx = {
                app,
                plugin: plugin.name,
                manifest: plugin.manifest,
                data: getPluginData(plugin.name),
                getData: () => getPluginData(plugin.name),
                setData: data => setPluginData(plugin.name, data),
                log: (...args) => console.log(`[plugin:${plugin.name}]`, ...args),
                onExport: null,
                media: require('./lib/media-store') // 媒体库：addRemote/removeRemote/listRemote
            };

            if (typeof mod === 'function') {
                mod(ctx);
            } else if (mod && typeof mod.setup === 'function') {
                mod.setup(ctx);
            }

            // 触发 onLoad 生命周期
            runPluginHook(plugin, 'onLoad', ctx);

            loaded.push({ name: plugin.name, manifest: plugin.manifest, ctx });
        } catch (e) {
            console.error(`[plugin-loader] 插件 ${plugin.name} 加载失败：`, e.message);
        }
    }

    return loaded;
}

function runPluginHook(plugin, hookName, ctx) {
    const modPath = path.join(PLUGINS_DIR, plugin.name, plugin.manifest.server || 'server.js');
    try {
        if (!fs.existsSync(modPath)) return;
        const mod = require(modPath);
        const fn = mod && mod.hooks && mod.hooks[hookName];
        if (typeof fn === 'function') fn(ctx);
    } catch (e) {
        console.warn(`[plugin-loader] ${plugin.name} 钩子 ${hookName} 失败：`, e.message);
    }
}

/* ---------------- 启停 ---------------- */

function setEnabled(name, enabled) {
    const state = getState();
    if (!state.installed.includes(name)) state.installed.push(name);
    if (enabled) {
        if (!state.enabled.includes(name)) state.enabled.push(name);
    } else {
        state.enabled = state.enabled.filter(n => n !== name);
    }
    saveState(state);
    return enabled;
}

function removePlugin(name) {
    const state = getState();
    state.installed = state.installed.filter(n => n !== name);
    state.enabled = state.enabled.filter(n => n !== name);
    saveState(state);

    const pluginPath = path.join(PLUGINS_DIR, safePluginPath(name));
    if (fs.existsSync(pluginPath)) {
        fs.rmSync(pluginPath, { recursive: true, force: true });
    }
}

module.exports = {
    PLUGINS_DIR,
    getState,
    saveState,
    readManifest,
    validateManifest,
    scanPlugins,
    getPluginData,
    setPluginData,
    loadEnabledPlugins,
    runPluginHook,
    setEnabled,
    removePlugin
};
