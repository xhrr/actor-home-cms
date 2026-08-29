/**
 * 媒体库持久化存储
 * 本地文件仍以 uploads/ 目录为准（见 lib/routes/config.js）；
 * 本模块只负责记录远程条目（如 Cloudflare R2 上传后返回的外链），
 * 数据存放在 data/media.json（随 data 卷持久化）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'media.json');
const MAX_REMOTE = 500; // 防止无限增长，保留最近 500 条

function readAll() {
    try {
        const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        return { remote: Array.isArray(store.remote) ? store.remote : [] };
    } catch (e) {
        return { remote: [] };
    }
}

function writeAll(store) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 4), 'utf-8');
}

/**
 * 新增远程条目（按 url 去重），返回当前完整远程列表。
 * entry: { url, key?, filename?, source? }
 */
function addRemote(entry) {
    const store = readAll();
    const url = String((entry && entry.url) || '').trim();
    if (!url) return store.remote;
    if (store.remote.some(r => r.url === url)) return store.remote;

    store.remote.unshift({
        id: crypto.randomUUID(),
        url,
        key: String((entry && entry.key) || ''),
        filename: String((entry && entry.filename) || ''),
        source: String((entry && entry.source) || 'r2'),
        createdAt: new Date().toISOString()
    });
    if (store.remote.length > MAX_REMOTE) store.remote.length = MAX_REMOTE;
    writeAll(store);
    return store.remote;
}

/** 按 id 删除远程条目 */
function removeRemote(id) {
    const store = readAll();
    const next = store.remote.filter(r => r.id !== id);
    if (next.length === store.remote.length) return false;
    store.remote = next;
    writeAll(store);
    return true;
}

function listRemote() {
    return readAll().remote;
}

module.exports = { readAll, addRemote, removeRemote, listRemote };