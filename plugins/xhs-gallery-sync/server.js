/**
 * 小红书图集同步插件（v0.1 · 知更数据消费端）
 *
 * 小红书采集统一由知更（Zhigeng，独立部署）完成，本插件不直接抓取小红书。
 * 职责：定时轮询知更内容库（platform=xhs）→ 去重 → 新笔记图片落 R2
 * （知更 r2 模式已直传的外链直接采用；本地缓存/源站的取回后经 sharp 转 webp 直传，
 * 复用 cloudflare-r2 插件配置）→ 写入 config.gallery.albums。
 *
 * 去重口径（对齐 mate/xhs 工具链经验）：
 *   1. 本插件 processed 列表（知更 work_id = 小红书 noteId）
 *   2. 存量图集 sourceUrl 提取 noteId（历史 210+ 条小红书图集天然对齐，首轮不会重复导入）
 *   3. 兜底：同日期 + 同标题（存量短链条目提不出 noteId 时用）
 *
 * 写入即生效范围：NAS 3123 实时站（动态路由直读 config）；公共站需手动导出推送（约定逐次指令）。
 * 运行态：processed / lastSync / lastStatus 存本插件数据内。
 */
const core = require('../../lib/core');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

const DEFAULT_AUTHOR = 'QMQ马倩倩';          // 与存量 274 条小红书图集的作者口径一致
const PROCESSED_CAP = 1000;                  // processed 上限（防无限增长）
const FAIL_STREAK_LIMIT = 3;                 // 单轮连续失败即停（事故 28 教训）
const NOTE_RE = /xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]{24})/;

/* ---------------- 通用 ---------------- */

/** 发布时间（知更为秒级时间戳）→ YYYY-MM-DD。显式按东八区取日期，容器时区无关 */
function dateFromPublish(publishTime) {
    let sec = Number(publishTime) || 0;
    if (!sec) return '';
    if (sec > 1e12) sec = Math.round(sec / 1000); // 兼容毫秒
    return new Date((sec + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

function markProcessed(config, workId) {
    const processed = Array.isArray(config.processed) ? config.processed : [];
    if (!processed.includes(workId)) processed.push(workId);
    config.processed = processed.slice(-PROCESSED_CAP);
}

/* ---------------- 知更 API ---------------- */

function zhigengBase(config) {
    // 默认走 docker 网关：mqq 容器为 bridge 网络，容器内 127.0.0.1 不是宿主机（实测 172.23.0.1 可达）
    return String(config.zhigengUrl || 'http://172.23.0.1:3223').trim().replace(/\/+$/, '');
}

async function zhigengFetch(config, path) {
    const res = await fetch(zhigengBase(config) + path, {
        headers: { 'X-Auth-Token': String(config.zhigengToken || '') },
        signal: AbortSignal.timeout(20000)
    });
    if (res.status === 401) throw new Error('知更口令无效（检查插件设置中的访问口令）');
    if (!res.ok) throw new Error(`知更接口 HTTP ${res.status}: ${path}`);
    return res.json();
}

/** 拉取知更里小红书平台的最新笔记（按发布时间降序，翻 fetchPages 页） */
async function fetchXhsWorks(config) {
    const pages = Math.min(5, Math.max(1, parseInt(config.fetchPages, 10) || 2));
    const all = [];
    for (let p = 1; p <= pages; p++) {
        const qs = new URLSearchParams({ platform: 'xhs', page: String(p), page_size: '50' });
        if (String(config.creatorId || '').trim()) qs.set('creator_id', String(config.creatorId).trim());
        const data = await zhigengFetch(config, '/api/works?' + qs.toString());
        const items = data.items || [];
        all.push(...items);
        if (!items.length || all.length >= (data.total || 0)) break;
    }
    // 知更按 publish_time DESC 返回，去重防御性处理
    return all.filter((w, i, arr) => arr.findIndex(x => x.work_id === w.work_id) === i);
}

/** 知更连通性 + 小红书博主列表（面板展示用） */
async function fetchXhsCreators(config) {
    const data = await zhigengFetch(config, '/api/creators');
    return (Array.isArray(data) ? data : []).filter(c => c.platform === 'xhs')
        .map(c => ({ id: c.id, uid: c.platform_uid, name: c.display_name || c.platform_uid, status: c.status }));
}

/* ---------------- 去重 ---------------- */

/** 存量图集 sourceUrl 中的小红书 noteId 集合 */
function buildExistingNoteIds(albums) {
    const set = new Set();
    for (const a of albums) {
        const m = a && a.sourceUrl && NOTE_RE.exec(String(a.sourceUrl));
        if (m) set.add(m[1]);
    }
    return set;
}

/** 兜底：同日期 + 同标题完全一致（短链条目提不出 noteId 时的保守判重，不用相似度避免误杀） */
function buildExistingTitleDatePairs(albums) {
    const set = new Set();
    for (const a of albums) {
        if (a && a.date && a.title) set.add(`${a.date}|${String(a.title).trim()}`);
    }
    return set;
}

/** 拉取并筛出未入库的新笔记（不下载、不写库） */
async function collectNewWorks(ctx) {
    const config = ctx.getData();
    const works = await fetchXhsWorks(config);
    const processed = new Set(Array.isArray(config.processed) ? config.processed : []);
    const configAll = core.readConfig();
    const albums = (configAll.gallery && configAll.gallery.albums) || [];
    const noteIds = buildExistingNoteIds(albums);
    const titleDates = buildExistingTitleDatePairs(albums);

    const newOnes = [];
    const skipped = { processed: 0, duplicated: 0, video: 0 };
    for (const w of works) {
        const id = String(w.work_id || '');
        if (!id) continue;
        if (processed.has(id)) { skipped.processed++; continue; }
        if (noteIds.has(id)) { skipped.duplicated++; continue; }
        if (w.kind === 'video') { skipped.video++; continue; } // 视频帖不入图集，apply 时标记 processed
        const date = dateFromPublish(w.publish_time);
        const title = String(w.title || '').trim();
        if (date && title && titleDates.has(`${date}|${title}`)) { skipped.duplicated++; continue; }
        newOnes.push({ work: w, date, title });
    }
    return { config, works, newOnes, skipped, r2: getR2Config(configAll) };
}

/* ---------------- R2 上传（复用 cloudflare-r2 插件配置） ---------------- */

function getR2Config(configAll) {
    const data = (configAll.plugins && configAll.plugins.data && configAll.plugins.data['cloudflare-r2']) || {};
    const ready = !!(data.accountId && data.accessKeyId && data.secretAccessKey && data.bucket && data.publicBaseUrl);
    // 归一化 publicBaseUrl（补协议、去尾斜杠），供「已是 R2 外链则直接采用」的判断
    let publicBase = String(data.publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (publicBase && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(publicBase)) publicBase = 'https://' + publicBase;
    return { data, ready, publicBase };
}

function r2PublicUrl(r2, key) {
    let base = String(r2.publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(base)) base = 'https://' + base;
    return `${base}/${key}`;
}

// 与 cloudflare-r2 插件 buildKey 同口径：prefix + [YYYY/MM/DD/] + 时间戳-随机（本插件固定随机名）
function buildR2Key(r2, ext) {
    let prefix = r2.keyPrefix == null ? 'images' : String(r2.keyPrefix).trim();
    prefix = prefix.replace(/^\/+|\/+$/g, '');
    const prefixPart = prefix ? prefix + '/' : '';
    let datePart = '';
    if (r2.dateSubfolder) {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        datePart = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}/`;
    }
    return prefixPart + datePart + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
}

function r2Client(r2) {
    const endpoint = r2.endpoint
        ? String(r2.endpoint).replace(/\/+$/, '')
        : `https://${r2.accountId}.r2.cloudflarestorage.com`;
    return new S3Client({
        region: r2.region || 'auto',
        endpoint,
        credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey }
    });
}

/**
 * 单张图 → 外链。三级来源：
 *   1. 知更 r2/both 模式已直传：media.url 就是图床外链（publicBaseUrl 前缀）→ 直接采用
 *   2. 知更本地缓存（local 模式或 R2 失败降级）：/media/<local_path>?t= 取回 → webp → 直传 R2
 *   3. 源站 URL（无本地缓存）：ci.xiaohongshu.com 取回 → 同上
 */
async function transferOneImage(ctx, pluginConfig, r2, media) {
    const directUrl = String(media.url || '');
    if (directUrl && r2.publicBase && directUrl.startsWith(r2.publicBase + '/')) {
        return directUrl; // 知更已直传 R2（scan 侧 storage_mode=r2/both），无需再转存
    }
    let buffer = null;
    const localPath = String(media.local_path || '').replace(/^\/+/, '');
    if (localPath) {
        try {
            const u = `${zhigengBase(pluginConfig)}/media/${localPath}?t=${encodeURIComponent(String(pluginConfig.zhigengToken || ''))}`;
            const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
            if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                if (buf.length > 100) buffer = buf;
            }
        } catch (e) { /* 回退源站 URL */ }
    }
    if (!buffer && media.url) {
        const res = await fetch(String(media.url), {
            headers: { Referer: 'https://www.xiaohongshu.com/' },
            signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) throw new Error('源站取图 HTTP ' + res.status);
        buffer = Buffer.from(await res.arrayBuffer());
    }
    if (!buffer) throw new Error('无可用媒体（本地缓存与源站均取不到）');

    // webp 转换（gif 保留动画不动；HEIC 等不支持的格式 sharp 会抛错，由上层跳过该图）
    let ext = '.' + (String(media.type || 'jpg').replace(/^\./, '') || 'jpg').toLowerCase();
    let payload = buffer;
    let contentType = 'image/jpeg';
    const isGif = ext === '.gif';
    if (r2.data.webpConvert && !isGif) {
        let pipeline = sharp(buffer);
        const maxWidth = parseInt(r2.data.maxWidth, 10);
        if (maxWidth > 0) pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
        const q = parseInt(r2.data.webpQuality, 10);
        payload = await pipeline.webp({ quality: (q >= 1 && q <= 100) ? q : 80 }).toBuffer();
        contentType = 'image/webp';
        ext = '.webp';
    } else {
        contentType = { '.gif': 'image/gif', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/jpeg';
    }

    const key = buildR2Key(r2.data, ext);
    await r2.client.send(new PutObjectCommand({ Bucket: r2.data.bucket, Key: key, Body: payload, ContentType: contentType }));
    const url = r2PublicUrl(r2.data, key);
    try {
        ctx.media.addRemote({ url, key, filename: localPath || String(media.url || ''), source: 'xhs-gallery-sync' });
    } catch (e) {
        ctx.log('媒体库登记失败（不影响图集）:', e.message);
    }
    return url;
}

/* ---------------- 主流程 ---------------- */

/**
 * 同步新笔记到图集。limit = 本轮最多导入条数（0/undefined = 不限，面板手动同步用）。
 * 每条成功后立即持久化 processed（setData 全量写 config.json，逐条落盘防中途崩丢记录）。
 */
async function syncNewWorks(ctx, { limit } = {}) {
    const { config, works, newOnes, skipped, r2 } = await collectNewWorks(ctx);
    if (!r2.ready) throw new Error('cloudflare-r2 插件配置缺失（先在该插件里配好 R2）');
    r2.client = r2Client(r2.data);

    const details = [];
    let imported = 0, failStreak = 0;
    for (const { work, date, title } of newOnes) {
        const id = String(work.work_id);
        if (limit && imported >= limit) break;
        try {
            const mediaList = (work.media || []).filter(m => m && (m.local_path || m.url));
            if (!mediaList.length) {
                // 视频帖/无图帖：标记 processed 跳过，否则每小时自动同步都会重试失败一次
                markProcessed(config, id);
                ctx.setData(config);
                details.push({ id, title: String(title || '').slice(0, 30), date, status: 'skipped', error: '无图片（视频帖或纯文字）' });
                ctx.log(`跳过 ${id}: 无图片（视频帖或纯文字）`);
                continue;
            }
            const urls = [];
            for (const m of mediaList) {
                try {
                    urls.push(await transferOneImage(ctx, config, r2, m));
                } catch (e) {
                    ctx.log(`单图跳过 ${id}:`, e.message); // 单图失败不阻断（对齐 ai-review 抽查图口径）
                }
            }
            if (!urls.length) throw new Error('全部图片处理失败');

            const album = {
                id: 'a-' + crypto.randomBytes(4).toString('base64url'),
                title: title || '新写真集',
                date,
                cover: urls[0],
                author: String(config.authorName === undefined ? DEFAULT_AUTHOR : config.authorName).trim()
                    || String(work.creator_name || '').trim(),
                sourceUrl: String(work.source_url || ''),
                images: urls
            };
            const fresh = core.readConfig(); // 逐条重读：缩小与后台保存互相覆盖的窗口
            fresh.gallery = fresh.gallery || { heading: '写真', albums: [] };
            fresh.gallery.albums.push(album);
            core.writeConfig(fresh);

            markProcessed(config, id);
            ctx.setData(config); // processed 即时落盘
            imported++;
            failStreak = 0;
            details.push({ id, title: title.slice(0, 30), date, images: urls.length, status: 'imported', albumId: album.id });
            ctx.log(`已导入图集: [${album.id}] ${title}（${urls.length} 图，${date}）`);
        } catch (e) {
            failStreak++;
            details.push({ id, title: String(title || '').slice(0, 30), date, status: 'failed', error: e.message });
            ctx.log(`导入失败 ${id}:`, e.message);
            if (failStreak >= FAIL_STREAK_LIMIT) {
                ctx.log(`连续 ${FAIL_STREAK_LIMIT} 条失败，中止本轮（下轮自动重试未标记的）`);
                break;
            }
        }
    }

    const failed = details.filter(d => d.status === 'failed').length;
    const status = `知更 ${works.length} 条｜新 ${newOnes.length}｜导入 ${imported}${failed ? '｜失败 ' + failed : ''}${skipped.video ? '｜视频帖 ' + skipped.video : ''}`;
    return { imported, failed, details, status, skipped, totalFetched: works.length };
}

/* ---------------- 路由 ---------------- */

module.exports = function (ctx) {
    // 知更连通性 + 小红书博主列表（面板展示）
    ctx.app.get('/api/plugins/xhs-gallery-sync/zhigeng/creators', async (req, res) => {
        try {
            const config = ctx.getData();
            const creators = await fetchXhsCreators(config);
            res.json({ ok: true, creators });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 拉取 + 去重预览（不下载、不写库）
    ctx.app.post('/api/plugins/xhs-gallery-sync/preview', async (req, res) => {
        try {
            const { works, newOnes, skipped, r2 } = await collectNewWorks(ctx);
            res.json({
                ok: true,
                total: works.length,
                newCount: newOnes.length,
                skipped,
                r2Ready: r2.ready,
                latest: works.slice(0, 5).map(w => ({
                    id: w.work_id, title: String(w.title || '').slice(0, 30),
                    date: dateFromPublish(w.publish_time), kind: w.kind
                })),
                items: newOnes.slice(0, 20).map(w => ({
                    id: w.work.id, title: w.title.slice(0, 40), date: w.date,
                    images: (w.work.media || []).length, creator: w.work.creator_name || ''
                })),
                message: newOnes.length
                    ? `知更最新 ${works.length} 条中有 ${newOnes.length} 条未入库`
                    : `知更最新 ${works.length} 条均已入库（去重：已处理 ${skipped.processed} / 库内已有 ${skipped.duplicated}${skipped.video ? ' / 视频帖 ' + skipped.video : ''}）`
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 完整同步：取图 → R2 → 写图集（手动触发不限制条数）
    ctx.app.post('/api/plugins/xhs-gallery-sync/apply', async (req, res) => {
        try {
            const result = await syncNewWorks(ctx, {});
            ctx.setData({ ...ctx.getData(), lastSync: new Date().toISOString(), lastStatus: result.status, lastError: '' });
            res.json({ ok: true, imported: result.imported, failed: result.failed, details: result.details, message: result.status });
        } catch (e) {
            ctx.setData({ ...ctx.getData(), lastError: new Date().toISOString() + ' ' + e.message });
            res.status(500).json({ error: e.message });
        }
    });

    // 清空 processed：靠存量图集 noteId 兜底去重，不会重复导入已入库内容
    ctx.app.post('/api/plugins/xhs-gallery-sync/reset', async (req, res) => {
        try {
            const config = ctx.getData();
            config.processed = [];
            ctx.setData(config);
            res.json({ ok: true, message: '已清空已处理记录（存量图集 noteId 去重仍然生效）' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 状态（配置掩码 + 知更连通性 + R2 就绪度）
    ctx.app.get('/api/plugins/xhs-gallery-sync/status', async (req, res) => {
        const d = ctx.getData();
        let zhigeng = { ok: false, creators: [] };
        try {
            zhigeng = { ok: true, creators: await fetchXhsCreators(d) };
        } catch (e) {
            zhigeng.error = e.message;
        }
        const r2 = getR2Config(core.readConfig());
        res.json({
            zhigengUrl: d.zhigengUrl || 'http://172.23.0.1:3223',
            zhigengToken: d.zhigengToken ? '***已配置***' : '',
            creatorId: d.creatorId || '',
            authorName: d.authorName === undefined ? DEFAULT_AUTHOR : d.authorName,
            maxPerRun: parseInt(d.maxPerRun, 10) || 5,
            fetchPages: parseInt(d.fetchPages, 10) || 2,
            autoSync: d.autoSync !== false,
            r2Ready: r2.ready,
            processed: Array.isArray(d.processed) ? d.processed.length : 0,
            lastSync: d.lastSync, lastStatus: d.lastStatus, lastError: d.lastError,
            zhigeng
        });
    });

    // 自动同步：每小时检查一次知更新帖（知更按自身节奏每日采集，此处只消费）
    const AUTO_INTERVAL = 60 * 60 * 1000;
    ctx.cron('auto-sync', AUTO_INTERVAL, async () => {
        try {
            const config = ctx.getData();
            if (config.autoSync === false) return;
            if (!config.zhigengToken) return; // 未配置知更口令则不自动跑
            const result = await syncNewWorks(ctx, { limit: parseInt(config.maxPerRun, 10) || 5 });
            if (result.imported || result.failed) {
                ctx.log('自动同步:', result.status);
            }
            ctx.setData({ ...ctx.getData(), lastSync: new Date().toISOString(), lastStatus: result.status, lastError: '' });
        } catch (e) {
            ctx.log('自动同步失败:', e.message);
            try {
                ctx.setData({ ...ctx.getData(), lastError: new Date().toISOString() + ' ' + e.message });
            } catch (_) { /* 尽力记录 */ }
        }
    });

    ctx.onExport = null;
};
