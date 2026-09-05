/**
 * QQ 频道监控插件（demo）—— 基于 tencent-channel-cli + 官方 WebSocket 网关
 * 触发：频道内 @ 机器人（AT_MESSAGE_CREATE）→ 秒级拉取最新帖子（CLI）→
 *       把新帖内容自动评论回原帖（feed do-comment，可关）。
 * 兜底：自适应轮询保留（事件为主、轮询兜底）。
 * 凭证：CLI 扫码登录态（~/.qqcli）+ 机器人 appId/clientSecret（面板配置，仅用于 WS 网关）。
 * 注意：单实例原则——只在生产实例启用自动轮询，避免双实例重复拉取。
 */
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const core = require('../../lib/core');

const BUNDLED_CLI = path.join(__dirname, 'bin', 'tencent-channel-cli');
const GATEWAY_URL = 'wss://api.sgroup.qq.com/websocket';
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
// 公域 @ 消息（1<<30）| 论坛帖子事件（1<<28，私域机器人生效）
const INTENTS = (1 << 30) | (1 << 28);

function cliPath(cfg) {
    const p = String(cfg.cliPath || '').trim();
    if (p) return p;
    return fs.existsSync(BUNDLED_CLI) ? BUNDLED_CLI : 'tencent-channel-cli';
}

/**
 * 运行 CLI 并解析 JSON。JSON 模式下 stdout 可能前置一行进度文本
 * （如「正在请求授权码...」），故从首个 { 起截取解析。
 */
function runCli(cfg, args, timeout = 30000) {
    return new Promise(resolve => {
        execFile(cliPath(cfg), args.concat(['-j']), { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            const text = String(stdout || '');
            const start = text.indexOf('{');
            if (start < 0) {
                return resolve({ ok: false, error: String(stderr || (err && err.message) || text || 'CLI 无输出').slice(0, 300) });
            }
            let json = null;
            try { json = JSON.parse(text.slice(start)); } catch (e) {
                return resolve({ ok: false, error: 'CLI 输出解析失败: ' + text.slice(start, start + 200) });
            }
            if (json && json.success === false) {
                return resolve({ ok: false, error: (json.error && json.error.message) || 'CLI 返回失败', type: json.error && json.error.type });
            }
            resolve({ ok: true, json });
        });
    });
}

/** 解析帖子列表（字段名为 get-guild-feeds 真实响应结构）。
 * 频道为空时 CLI 不输出 feeds 键（只有 has_more），按空列表处理。 */
function extractFeeds(json) {
    const root = (json && (json.data || json)) || {};
    const list = Array.isArray(root) ? root : (root.feeds || root.list || root.items || root.feed_list);
    if (list === undefined && json && json.success) return [];
    if (!Array.isArray(list)) return null;
    return list.map(f => ({
        id: String(f.feed_id || f.id || ''),
        title: String(f.title || '').trim(),
        content: String(f.content_snippet || f.content || '').trim(),
        time: String(f.create_time || '').trim(),
        timeRaw: String(f.create_time_raw || '').trim(),
        author: String(f.author || '').trim(),
        authorId: String(f.author_id || '').trim(),
        channelName: String(f.channel_name || '').trim()
    })).filter(f => f.id);
}

function stripContent(s) {
    return String(s || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图]')
        .replace(/\[图片\]|\[表情\]|\[视频\]/g, '')
        .replace(/[#>*`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchFeeds(ctx) {
    const cfg = ctx.getData();
    const guildId = String(cfg.guildId || '').trim();
    if (!guildId) return { ok: false, error: '请先在面板填写频道 ID（guild-id）' };
    const r = await runCli(cfg, ['feed', 'get-guild-feeds', '--guild-id', guildId, '--get-type', '2', '--count', String(parseInt(cfg.count, 10) || 20)]);
    // 原始输出截断留档，字段对不上时在面板可见，便于调整解析
    const cfg2 = ctx.getData();
    ctx.setData({ ...cfg2, lastRaw: JSON.stringify(r.json || { error: r.error }).slice(0, 2000) });
    return r;
}

/** 拉取最新帖子；mark=true 时标记已见（只写插件自身数据） */
async function fetchNew(ctx, mark = true) {
    const r = await fetchFeeds(ctx);
    if (!r.ok) return r;
    const feeds = extractFeeds(r.json);
    if (feeds === null) return { ok: false, error: '未能从 CLI 输出解析出帖子列表（原始输出已存 lastRaw 供排查）' };
    const cfg = ctx.getData();
    const processed = Array.isArray(cfg.processed) ? cfg.processed.slice() : [];
    const kw = String(cfg.keyword || '').trim();
    const fresh = feeds
        .filter(f => !processed.includes(f.id))
        .filter(f => !kw || (f.title + ' ' + f.content).includes(kw));
    if (mark && fresh.length) {
        for (const f of fresh) processed.push(f.id);
        while (processed.length > 500) processed.shift();
    }
    const cfgNow = ctx.getData();
    ctx.setData({
        ...cfgNow,
        processed,
        lastStatus: `拉取 ${feeds.length} 条，新帖 ${fresh.length} 条`,
        lastCheck: new Date().toISOString()
    });
    return {
        ok: true,
        total: feeds.length,
        latest: feeds.length ? { id: feeds[0].id, content: feeds[0].content, timeRaw: feeds[0].timeRaw } : null,
        fresh: fresh.map(f => ({
            id: f.id,
            title: stripContent(f.title) || stripContent(f.content).slice(0, 30) || f.id,
            content: stripContent(f.content),
            time: f.time,
            timeRaw: f.timeRaw,
            author: f.author
        }))
    };
}

/* ---------------- 帖子 → GitHub Issue（按版块解析） ----------------
 * 版块决定类型（boardMap 面板可配）；正文必须自带原始链接，没有就整帖跳过；
 * 字段抽取：AI（默认开，凭证继承 weibo-watch 的 MiMo 配置）→ 失败降级最小字段；
 * 图片：下载 → WebP → 上传 cloudflare-r2 配置的桶（媒体库同步登记）→ 外链进 images；
 * 产出 README 约定格式的 Issue（label 默认 qq-channel，人工过目后改 approved）。 */

const ISSUE_LABEL_DEFAULT = 'qq-channel';
const BOARD_MAP_DEFAULT = '作品新增=works\n图集新增=album\n动态=news\n行程=schedule\n荣誉=awards';
const QQ_DOMAIN_RE = /qpic\.cn|gtimg\.cn|qq\.com/i;
const TYPE_FIELDS = {
    works: ['category', 'title', 'role', 'year', 'director', 'synopsis'],
    album: ['title', 'author'],
    news: ['date', 'title', 'summary'],
    awards: ['year', 'name', 'org', 'work'],
    schedule: ['date', 'city', 'event']
};

function getBoardMap(cfg) {
    const map = {};
    String(cfg.boardMap || BOARD_MAP_DEFAULT).split(/\r?\n/).forEach(line => {
        const i = line.indexOf('=');
        if (i > 0) {
            const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim().toLowerCase();
            if (k && v) map[k] = v;
        }
    });
    return map;
}

function boardToType(cfg, board) {
    const b = String(board || '').trim();
    const map = getBoardMap(cfg);
    if (map[b]) return map[b];
    if (/作品/.test(b)) return 'works';
    if (/图集|写真/.test(b)) return 'album';
    if (/行程/.test(b)) return 'schedule';
    if (/荣誉/.test(b)) return 'awards';
    if (/动态/.test(b)) return 'news';
    return null;
}

/** 原始链接：正文显式 sourceUrl: kv 优先，其次第一个非 QQ 域名的 URL；没有返回空 */
function extractSourceUrl(content) {
    const text = String(content || '');
    const kv = text.match(/^\s*sourceUrl\s*[:：]\s*(\S+)\s*$/mi);
    if (kv) return kv[1].trim();
    const urls = text.match(/https?:\/\/[^\s，,。；；）)】\]"']+/g) || [];
    const hit = urls.find(u => !QQ_DOMAIN_RE.test(u));
    return hit || '';
}

/** 标题清洗：去 @提及、链接、原作者标注、零宽字符，留干净文案 */
function cleanTitle(s) {
    return String(s || '')
        .replace(/@[\w\u4e00-\u9fff-]+/g, ' ')
        .replace(/链接[:：]?\s*\S+/g, ' ')
        .replace(/原作者[:：]\s*\S+/g, ' ')
        .replace(/\u200b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** repo 简写统一成 owner/repo（支持完整 URL / git@ / 尾部 .git） */
function normalizeRepo(repo) {
    let r = String(repo || '').trim().replace(/\.git$/, '');
    r = r.replace(/^https?:\/\/github\.com\//i, '');
    r = r.replace(/^git:\/\/github\.com\//i, '');
    r = r.replace(/^git@github\.com:/i, '');
    return r.replace(/\/+$/, '');
}

/** AI 配置：本插件字段优先，空则继承 weibo-watch 的 MiMo 配置 */
function aiConfig(cfg) {
    const data = (core.readConfig().plugins || {}).data || {};
    const w = data['weibo-watch'] || {};
    const g = data['github-issues'] || {};
    return {
        baseUrl: String(cfg.aiBaseUrl || w.llmBaseUrl || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, ''),
        model: cfg.aiModel || w.llmModel || 'mimo-v2.5',
        key: cfg.aiKey || w.llmKey || '',
        issueRepo: normalizeRepo(cfg.issueRepo || g.repo || ''),
        issueToken: String(cfg.issueToken || g.token || '').trim(),
        issueLabel: String(cfg.issueLabel || ISSUE_LABEL_DEFAULT).trim()
    };
}

function buildPrompt(type, board, title, imageCount) {
    const spec = {
        works: 'category=题材分类（电视剧/短剧/电影/影游之一）、title=作品名、role=饰演角色、year=上映时间、director=导演、synopsis=一句话简介',
        album: 'title=写真集标题、author=摄影师或来源作者',
        news: 'date=日期、title=动态标题、summary=一句话摘要',
        awards: 'year=获奖年份、name=奖项名称、org=颁奖方、work=关联作品',
        schedule: 'date=日期、city=城市、event=活动事项'
    }[type] || 'title=标题';
    return `你是内容录入助手。QQ 频道「${board}」版块的新帖子将录入为「${type}」类型的内容。
只从帖子正文提取信息，输出一个 JSON 对象，字段：${spec}。
要求：
1. 正文没有的字段一律输出空字符串，不要编造。
2. title 要干净：去掉链接（及其"链接:"前缀）、@提及、"原作者:"标注、表情与多余空白后取主体文案，不超过 20 字。
3. author 从「原作者:xxx」或正文署名提取；没有则空字符串。
4. 日期类字段只有年份输出 YYYY，只有年月输出 YYYY.MM。
5. 只输出 JSON，不要解释或代码块标记。
帖子标题：${title}
帖子附带图片 ${imageCount} 张（图片不参与解析）。`;
}

async function parseWithAI(cfg, type, board, title, content, imageCount) {
    const ai = aiConfig(cfg);
    if (!ai.key) return { ok: false, error: '未配置 AI Key（继承 weibo-watch 或本面板填写）' };
    const res = await fetch(ai.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.key },
        body: JSON.stringify({
            model: ai.model,
            messages: [
                { role: 'system', content: buildPrompt(type, board, title, imageCount) },
                { role: 'user', content: String(content || '').slice(0, 3000) }
            ],
            temperature: 0.1
        }),
        signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) return { ok: false, error: 'AI 接口 HTTP ' + res.status };
    const body = await res.json();
    const out = (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '';
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: 'AI 未输出 JSON' };
    try {
        const fields = JSON.parse(m[0]);
        const clean = {};
        (TYPE_FIELDS[type] || []).forEach(k => { clean[k] = String(fields[k] || '').trim(); });
        return { ok: true, fields: clean };
    } catch (e) { return { ok: false, error: 'AI JSON 解析失败' }; }
}

function buildBlock(type, fields, sourceUrl, imageUrls) {
    const lines = ['type: ' + type];
    const put = (k, v) => { if (v) lines.push(k + ': ' + v); };
    if (type === 'works') {
        put('category', fields.category); put('title', fields.title); put('role', fields.role);
        put('year', fields.year); put('director', fields.director); put('sourceUrl', sourceUrl);
        put('synopsis', fields.synopsis);
        if (imageUrls.length) { lines.push('images:'); imageUrls.forEach(u => lines.push('  - ' + u)); }
    } else if (type === 'album') {
        put('title', fields.title); put('author', fields.author); put('sourceUrl', sourceUrl);
        if (imageUrls.length) { lines.push('images:'); imageUrls.forEach(u => lines.push('  - ' + u)); }
    } else if (type === 'news') {
        put('date', fields.date); put('title', fields.title); put('summary', fields.summary); put('sourceUrl', sourceUrl);
    } else if (type === 'awards') {
        put('year', fields.year); put('name', fields.name); put('org', fields.org); put('work', fields.work);
    } else if (type === 'schedule') {
        put('date', fields.date); put('city', fields.city); put('event', fields.event); put('sourceUrl', sourceUrl);
    }
    return lines.join('\n');
}

async function getFeedDetail(cfg, feedId) {
    const r = await runCli(cfg, ['feed', 'get-feed-detail', '--feed-id', feedId, '--guild-id', String(cfg.guildId || '')]);
    if (!r.ok) return r;
    const f = (r.json.data || {}).feed;
    if (!f) return { ok: false, error: '详情无 feed 数据' };
    return {
        ok: true,
        feed: {
            id: String(f.feed_id || feedId),
            title: stripContent(f.title || ''),
            content: stripContent(f.content || (f.content_richtext && f.content_richtext.text) || ''),
            board: String(f.channel_name || '').trim(),
            time: String(f.create_time || '').trim(),
            timeRaw: String(f.create_time_raw || '').trim(),
            shareUrl: String(f.share_url || '').trim(),
            images: (Array.isArray(f.images) ? f.images : []).map(im => ({
                url: String(im.picUrl || im.url || ''),
                width: parseInt(im.width, 10) || 0,
                height: parseInt(im.height, 10) || 0
            })).filter(im => im.url)
        }
    };
}

async function downloadImage(url) {
    const attempt = referer => fetch(url, {
        headers: referer ? { 'Referer': referer, 'User-Agent': 'Mozilla/5.0' } : {},
        signal: AbortSignal.timeout(30000)
    });
    let res = await attempt(false);
    if (res.status === 403 || res.status === 404) res = await attempt('https://pd.qq.com/');
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return (buf.length && buf.length < 25 * 1024 * 1024) ? buf : null;
}

const IMG_CONTENT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/** 按 cloudflare-r2 插件配置上传（WebP 压缩/媒体库登记与其保持一致） */
async function uploadToR2(ctx, buf, tag) {
    const data = (core.readConfig().plugins || {}).data || {};
    const rc = data['cloudflare-r2'] || {};
    if (!rc.accountId || !rc.accessKeyId || !rc.secretAccessKey || !rc.bucket || !rc.publicBaseUrl) {
        return { ok: false, error: 'cloudflare-r2 插件配置不完整' };
    }
    const sharp = require('sharp');
    let body = buf, contentType = 'application/octet-stream', outExt = '.jpg';
    let pipeline = sharp(buf).metadata().then(meta => ({ pipeline: sharp(buf), format: meta.format }));
    const meta = await sharp(buf).metadata();
    const srcFormat = (meta.format || 'jpeg').toLowerCase();
    if (rc.webpConvert && srcFormat !== 'gif') {
        let p = sharp(buf);
        const mw = parseInt(rc.maxWidth, 10);
        if (mw > 0) p = p.resize({ width: mw, withoutEnlargement: true });
        const q = parseInt(rc.webpQuality, 10);
        body = await p.webp({ quality: (q >= 1 && q <= 100) ? q : 80 }).toBuffer();
        contentType = 'image/webp';
        outExt = '.webp';
    } else {
        outExt = '.' + (srcFormat === 'jpeg' ? 'jpg' : srcFormat);
        contentType = IMG_CONTENT_TYPES[srcFormat] || 'application/octet-stream';
    }
    let prefix = rc.keyPrefix == null ? 'images' : String(rc.keyPrefix).trim().replace(/^\/+|\/+$/g, '');
    const prefixPart = prefix ? prefix + '/' : '';
    let datePart = '';
    if (rc.dateSubfolder) {
        const d = new Date(), pad = n => String(n).padStart(2, '0');
        datePart = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}/`;
    }
    const key = prefixPart + datePart + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + outExt;
    const endpoint = rc.endpoint ? String(rc.endpoint).replace(/\/+$/, '') : `https://${rc.accountId}.r2.cloudflarestorage.com`;
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({ region: rc.region || 'auto', endpoint, credentials: { accessKeyId: rc.accessKeyId, secretAccessKey: rc.secretAccessKey } });
    await client.send(new PutObjectCommand({ Bucket: rc.bucket, Key: key, Body: body, ContentType: contentType }));
    let base = String(rc.publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(base)) base = 'https://' + base;
    const url = base + '/' + key;
    try { ctx.media.addRemote({ url, key, filename: 'channel-' + tag + outExt, source: 'r2' }); } catch (e) { /* 媒体库失败不阻塞 */ }
    return { ok: true, url };
}

/** 单帖全流程：detail → 门槛 → 图片转存 → 解析 → Issue（create=false 仅产出文本） */
async function processFeedIssue(ctx, feed, opts) {
    const cfg = ctx.getData();
    const detail = await getFeedDetail(cfg, feed.id);
    if (!detail.ok) return { ok: false, skip: '详情获取失败：' + String(detail.error).slice(0, 80) };
    const f = detail.feed;

    const type = boardToType(cfg, f.board);
    if (!type) return { ok: false, skip: `版块「${f.board}」未配置类型映射` };

    const sourceUrl = extractSourceUrl(f.content);
    if (!sourceUrl) return { ok: false, skip: '未带原始链接' };

    const title = cleanTitle(f.title) || cleanTitle(f.content).slice(0, 30) || '频道动态';

    let imageUrls = f.images.map(im => im.url);
    let transferFailed = 0;
    if (opts.transferImages && f.images.length) {
        const urls = [];
        for (let i = 0; i < f.images.length; i++) {
            const buf = await downloadImage(f.images[i].url);
            if (!buf) { transferFailed++; continue; }
            const up = await uploadToR2(ctx, buf, feed.id.slice(-8) + '-' + (i + 1));
            if (up.ok) urls.push(up.url); else { transferFailed++; ctx.log('R2 上传失败:', up.error); }
        }
        if (urls.length) imageUrls = urls;
    }

    let fields = {}, parseBy = 'minimal';
    if (cfg.aiEnabled !== false) {
        const ai = await parseWithAI(cfg, type, f.board, title, f.content, f.images.length);
        if (ai.ok) { fields = ai.fields; parseBy = 'ai'; }
        else ctx.log('AI 解析失败（' + title.slice(0, 20) + '）:', ai.error);
    }
    if (!fields.title) fields.title = title;

    const body = buildBlock(type, fields, sourceUrl, imageUrls)
        + (transferFailed ? `\n\n（另有 ${transferFailed} 张图片转存失败，请对照频道帖子原图）` : '');
    const issueTitle = (`[QQ频道·${f.board}] ${fields.title || title}`).slice(0, 80);

    if (!opts.create) return { ok: true, staged: true, type, parseBy, sourceUrl, issueTitle, body, imageCount: imageUrls.length, transferFailed };

    const ai = aiConfig(cfg);
    if (!ai.issueRepo || !ai.issueToken) return { ok: false, skip: 'github-issues 插件未配置 repo/token，无法创建 Issue' };
    const cres = await fetch(`https://api.github.com/repos/${ai.issueRepo}/issues`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ai.issueToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Actor-CMS',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: issueTitle, body, labels: ai.issueLabel ? [ai.issueLabel] : [] })
    });
    if (!cres.ok) return { ok: false, retry: true, skip: 'Issue 创建失败 HTTP ' + cres.status + ': ' + (await cres.text()).slice(0, 150) };
    const issue = await cres.json();
    return { ok: true, created: true, issueUrl: issue.html_url, issueTitle, type, parseBy };
}

/** 定时主管线：拉新帖 → 逐帖转 Issue → 统一标记。
 * opts.create：是否真正创建 Issue（默认按面板开关）；opts.mark：是否标记已见（预览时 false） */
async function runIssuePipeline(ctx, opts = {}) {
    const cfg = ctx.getData();
    const processed = Array.isArray(cfg.processed) ? cfg.processed.slice() : [];
    const issueDone = Array.isArray(cfg.issueFeedIds) ? cfg.issueFeedIds.slice() : [];
    const replied = Array.isArray(cfg.repliedFeedIds) ? cfg.repliedFeedIds.slice() : [];
    // 去重以「已建 Issue」为准；自动创建为面板开关（默认关，走预览→点击更新的人工流）
    const create = opts.create !== undefined ? opts.create : (cfg.autoCreateIssue === true);
    const transfer = opts.transfer !== undefined ? opts.transfer : create;
    const mark = opts.mark !== false;

    let fresh;
    if (Array.isArray(opts.ids)) {
        fresh = opts.ids.filter(id => id && !issueDone.includes(id)).map(id => ({ id }));
        if (!fresh.length) return { ok: true, total: 0, created: 0, skipped: 0, results: [], message: '预览条目均已创建过 Issue' };
    } else {
        const pulled = await fetchNew(ctx, mark);
        if (!pulled.ok) return pulled;
        fresh = pulled.fresh.filter(f => !issueDone.includes(f.id));
    }
    const results = [], skipped = [];
    let created = 0;

    for (const feed of fresh) {
        let r;
        try {
            r = await processFeedIssue(ctx, feed, { create, transferImages: transfer });
        } catch (e) {
            // 单帖异常不拖垮整批：按跳过处理并标记
            r = { skip: '处理异常：' + e.message };
            if (mark) processed.push(feed.id);
            skipped.push({ title: String(feed.title || feed.id || '').slice(0, 30), reason: r.skip });
            results.push({ id: feed.id, title: String(feed.title || feed.id || '').slice(0, 30), skip: r.skip });
            continue;
        }
        if (r.skip !== undefined) {
            if (mark) {
                processed.push(feed.id);      // 跳过/失败的帖子也标记，避免每小时重复处理
                if (!r.retry) skipped.push({ title: String(feed.title || feed.id || '').slice(0, 30), reason: r.skip });
            }
            if (r.created) issueDone.push(feed.id);
        } else if (r.ok && r.created) {
            if (mark) { processed.push(feed.id); issueDone.push(feed.id); }
            created++;
        } else if (r.ok && r.staged && mark) {
            processed.push(feed.id);          // 未开自动创建（预览模式）：标记已见，避免重复处理
        }

        // 回执：处理完的回「已处理」，处理失败的回「因为xxx未处理」（幂等，预览模式不发）
        let statusText = null;
        if (r.created) statusText = '已处理';
        else if (r.skip !== undefined) statusText = `因为${r.skip}未处理`;
        if (statusText && mark && cfg.statusReply !== false && !replied.includes(feed.id)) {
            const rep = await runCli(cfg, ['feed', 'do-comment', '--feed-id', feed.id, '--feed-create-time', toMs(feed.timeRaw), '--content', statusText, '--comment-type', '1'], 30000);
            if (rep.ok) replied.push(feed.id);
            else ctx.log('回执失败（', feed.id.slice(-8), '）:', rep.error);
        }
        results.push({ id: feed.id, title: (feed.title || feed.id || '').slice(0, 30), type: r.type, parseBy: r.parseBy, skip: r.skip, issueUrl: r.issueUrl, issueTitle: r.issueTitle, body: r.body });
    }
    while (processed.length > 500) processed.shift();
    while (issueDone.length > 500) issueDone.shift();
    while (replied.length > 500) replied.shift();
    while (skipped.length > 20) skipped.shift();

    const cfgNow = ctx.getData();
    ctx.setData({
        ...cfgNow,
        processed: mark ? processed : (cfg.processed || []),
        issueFeedIds: mark ? issueDone : (cfg.issueFeedIds || []),
        repliedFeedIds: mark ? replied : (cfg.repliedFeedIds || []),
        lastSkipped: mark ? skipped : (cfg.lastSkipped || []),
        lastStatus: mark
            ? (create
                ? `拉取 ${fresh.length} 条，建 Issue ${created} 条，跳过 ${skipped.length} 条`
                : `拉取 ${fresh.length} 条（未建 Issue：面板已关闭自动创建）`)
            : `预览解析 ${fresh.length} 条（未建 Issue、未转存图片）`,
        lastCheck: new Date().toISOString()
    });
    return { ok: true, total: fresh.length, created, skipped: skipped.length, results };
}

/* ---------------- 官方 WebSocket 网关：@ 触发 ----------------
 * 频道内 @ 机器人 → 网关秒级推送 AT_MESSAGE_CREATE → 拉取最新帖子 →
 * 新帖内容自动评论回原帖（autoComment 可关）。断线指数退避重连。 */

// 模块级单例：插件热启停时复用，避免残留连接与心跳定时器
let wsMgr = null;
function mgr() {
    if (!wsMgr) wsMgr = {
        ws: null, connected: false, session: null, seq: 0, heartbeat: null,
        reconnects: 0, lastEventAt: null, lastError: '',
        token: null, tokenExpiresAt: 0, inFlight: false, gen: 0
    };
    return wsMgr;
}

async function getAccessToken(cfg, st, force) {
    if (!force && st.token && st.tokenExpiresAt > Date.now() + 5 * 60 * 1000) return st.token;
    const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: cfg.appId, clientSecret: cfg.clientSecret })
    });
    const t = await r.json();
    if (!t.access_token) throw new Error('换取 access_token 失败: ' + JSON.stringify(t).slice(0, 150));
    st.token = t.access_token;
    st.tokenExpiresAt = Date.now() + (parseInt(t.expires_in, 10) || 6600) * 1000;
    return st.token;
}

/** 帖子创建时间统一为毫秒时间戳（腾讯评论接口要求 ms，列表返回的是秒） */
function toMs(t) {
    const n = parseInt(t, 10);
    if (!n) return '';
    return String(n < 1e12 ? n * 1000 : n);
}

function handleEvent(ctx, type, d) {
    const who = (d && d.author && (d.author.username || d.author.id)) || '?';
    const brief = String((d && d.content) || '').replace(/\s+/g, ' ').slice(0, 40);
    ctx.log(type, 'from', who, ':', brief);
    onTrigger(ctx, type);
}

async function onTrigger(ctx, eventName) {
    const st = mgr();
    if (st.inFlight) { ctx.log(eventName, '触发到达，前一次拉取仍在进行，跳过'); return; }
    st.inFlight = true;
    st.lastEventAt = new Date().toISOString();
    try {
        const r = await fetchNew(ctx);
        if (!r.ok) { st.lastError = '拉取失败: ' + r.error; ctx.log(eventName, '触发拉取失败:', r.error); return; }
        const cfg = ctx.getData();
        const commented = Array.isArray(cfg.commentedFeedIds) ? cfg.commentedFeedIds.slice() : [];
        let comments = 0;
        if (cfg.autoComment !== false) {
            // 目标：本次拉到的新帖；没有新帖时取最新一条未被评论过的帖子（便于 @ 直接演示）
            let targets = r.fresh.filter(f => f.content && !commented.includes(f.id));
            if (!targets.length && r.latest && r.latest.content && !commented.includes(r.latest.id)) targets = [r.latest];
            for (const f of targets) {
                const c = await runCli(cfg, ['feed', 'do-comment', '--feed-id', f.id, '--feed-create-time', toMs(f.timeRaw), '--content', f.content, '--comment-type', '1'], 30000);
                if (c.ok) { commented.push(f.id); comments++; ctx.log('已评论帖子', f.id.slice(0, 14) + '…'); }
                else ctx.log('评论失败（feed', f.id.slice(0, 14) + '…）:', c.error);
            }
            while (commented.length > 500) commented.shift();
        }
        const cfgNow = ctx.getData();
        ctx.setData({
            ...cfgNow,
            commentedFeedIds: commented,
            lastStatus: `@触发（${eventName}）：新帖 ${r.fresh.length} 条，已评论 ${comments} 条`
        });
        if (r.fresh.length || comments) ctx.log(eventName, ': 新帖', r.fresh.length, '条，评论', comments, '条');
    } catch (e) {
        mgr().lastError = e.message;
        ctx.log('触发处理异常:', e.message);
    } finally {
        mgr().inFlight = false;
    }
}

function startWS(ctx) {
    const st = mgr();
    const cfg = ctx.getData();
    st.gen++;
    const gen = st.gen;
    if (st.ws) {
        try { st.ws.removeAllListeners(); st.ws.close(); } catch (e) { /* 忽略 */ }
        if (st.heartbeat) clearInterval(st.heartbeat);
        st.ws = null;
    }
    st.connected = false;

    if (!cfg.appId || !cfg.clientSecret) {
        st.lastError = '未配置 appId/clientSecret，WebSocket 未启动';
        return false;
    }

    getAccessToken(cfg, st, false).then(token => {
        if (gen !== st.gen) return;
        const ws = new WebSocket(GATEWAY_URL);
        st.ws = ws;
        ws.on('open', () => ctx.log('WS 网关已连接'));
        ws.on('message', raw => {
            if (gen !== st.gen) return;
            let p = null;
            try { p = JSON.parse(raw); } catch (e) { return; }
            if (p.op === 10) {
                st.heartbeat = setInterval(() => {
                    try { ws.send(JSON.stringify({ op: 1, d: st.seq })); } catch (e) { /* 忽略 */ }
                }, p.d.heartbeat_interval || 30000);
                ws.send(JSON.stringify({ op: 2, d: { token: 'QQBot ' + token, intents: INTENTS, shard: [0, 1] } }));
            } else if (p.op === 0) {
                st.seq = p.s;
                if (p.t === 'READY') {
                    st.connected = true;
                    st.session = p.d.session_id;
                    st.reconnects = 0;
                    st.lastError = '';
                    ctx.log('WS 就绪，session', st.session);
                } else if (p.t === 'AT_MESSAGE_CREATE' || String(p.t).indexOf('FORUM_') === 0) {
                    handleEvent(ctx, p.t, p.d);
                }
            } else if (p.op === 7) {
                ctx.log('服务端要求重连（op7）');
                try { ws.close(); } catch (e) { /* 忽略 */ }
            } else if (p.op === 9) {
                st.lastError = '网关拒绝 Identify（op9）：检查 appId/clientSecret 与机器人权限';
                ctx.log(st.lastError);
            }
        });
        ws.on('close', (code) => {
            if (gen !== st.gen) return;
            clearInterval(st.heartbeat);
            st.connected = false;
            st.ws = null;
            st.reconnects++;
            const delay = Math.min(60000, 1000 * Math.pow(2, Math.min(st.reconnects, 6)));
            st.lastError = `连接断开（${code}），${Math.round(delay / 1000)}s 后重连`;
            ctx.log(st.lastError);
            setTimeout(() => { if (gen === st.gen) startWS(ctx); }, delay);
        });
        ws.on('error', err => { if (gen === st.gen) st.lastError = 'WS 错误: ' + err.message; });
    }).catch(e => {
        if (gen !== st.gen) return;
        st.connected = false;
        st.lastError = e.message;
        st.reconnects++;
        const delay = Math.min(60000, 1000 * Math.pow(2, Math.min(st.reconnects, 6)));
        ctx.log('WS 启动失败:', e.message, `，${Math.round(delay / 1000)}s 后重试`);
        setTimeout(() => { if (gen === st.gen) startWS(ctx); }, delay);
    });
    return true;
}

module.exports = function (ctx) {
    // 登录态与运行状态（每次调用实跑 login status，结果即健康检查）
    ctx.app.get('/api/plugins/qq-channel-watch/status', async (req, res) => {
        try {
            const cfg = ctx.getData();
            const login = await runCli(cfg, ['login', 'status'], 15000);
            const st = mgr();
            res.json({
                loggedIn: !!login.ok,
                loginDetail: login.ok ? '已登录' : String(login.error || '').slice(0, 120),
                enabled: cfg.enabled !== false,
                guildId: cfg.guildId || '',
                pollInterval: parseInt(cfg.pollInterval, 10) || 10,
                processedCount: (cfg.processed || []).length,
                lastStatus: cfg.lastStatus || '',
                lastCheck: cfg.lastCheck || '',
                lastRaw: cfg.lastRaw || '',
                lastSkipped: cfg.lastSkipped || [],
                autoCreateIssue: cfg.autoCreateIssue === true,
                statusReply: cfg.statusReply !== false,
                repliedCount: (cfg.repliedFeedIds || []).length,
                issueLabel: cfg.issueLabel || 'qq-channel',
                issueFeedCount: (cfg.issueFeedIds || []).length,
                boardMap: cfg.boardMap || '',
                appIdMasked: cfg.appId ? String(cfg.appId).slice(0, 4) + '****' : '',
                autoComment: cfg.autoComment !== false,
                ws: {
                    configured: !!(cfg.appId && cfg.clientSecret),
                    connected: st.connected,
                    lastEventAt: st.lastEventAt,
                    lastError: st.lastError,
                    reconnects: st.reconnects
                }
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 面板数据缓存用：返回插件完整数据（含 processed/issueFeedIds 等，供面板保存时合并不覆盖）
    ctx.app.get('/api/plugins/qq-channel-watch/data', (req, res) => {
        res.json(ctx.getData());
    });

    // 立即处理：手动触发完整管线（拉帖→转图→解析→按面板开关建 Issue），并重置兜底轮询计时
    ctx.app.post('/api/plugins/qq-channel-watch/process-now', async (req, res) => {
        try {
            lastPoll = Date.now();
            const r = await runIssuePipeline(ctx);
            res.json(r);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 预览解析结果：走完整解析但不建 Issue、不转存图片、不标记已见；暂存待建条目供「更新到 Issues」使用
    ctx.app.post('/api/plugins/qq-channel-watch/preview-parse', async (req, res) => {
        try {
            const r = await runIssuePipeline(ctx, { create: false, mark: false });
            const pending = (r.results || []).filter(x => !x.skip && x.id).map(x => x.id);
            const cfgNow = ctx.getData();
            ctx.setData({ ...cfgNow, lastPreviewIds: pending });
            res.json({ ...r, pendingCount: pending.length });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 更新到 Issues：把最近一次预览的条目真正转存图片并创建 Issue
    ctx.app.post('/api/plugins/qq-channel-watch/create-issues', async (req, res) => {
        try {
            const data = ctx.getData();
            const ids = Array.isArray(data.lastPreviewIds) ? data.lastPreviewIds : [];
            if (!ids.length) return res.status(400).json({ error: '没有待创建的条目，请先「预览解析结果」' });
            const r = await runIssuePipeline(ctx, { ids, create: true, transfer: true, mark: true });
            res.json(r);
        } catch (e) {
            ctx.log('create-issues 异常:', e && e.stack || e);
            res.status(500).json({ error: e.message });
        }
    });

    // 用面板最新凭证重连 WS 网关
    ctx.app.post('/api/plugins/qq-channel-watch/ws/reconnect', async (req, res) => {
        try {
            const started = startWS(ctx);
            res.json({ success: true, started });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 获取登录二维码（JSON 模式立即返回，不阻塞）
    ctx.app.post('/api/plugins/qq-channel-watch/login/qrcode', async (req, res) => {
        try {
            const r = await runCli(ctx.getData(), ['login'], 30000);
            if (!r.ok) return res.status(500).json({ error: r.error });
            const d = r.json.data || r.json || {};
            res.json({
                qrDataUrl: d.qr_code ? 'data:image/png;base64,' + d.qr_code : '',
                link: d.link || d.url || '',
                expiresIn: d.expires_in_s || 599,
                message: d.message || ''
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 我已扫码：后台轮询授权结果（CLI 侧最长等 10 分钟；页面轮询 poll-status 看结果）
    let loginPoll = null;
    ctx.app.post('/api/plugins/qq-channel-watch/login/poll', (req, res) => {
        if (loginPoll && !loginPoll.done) return res.json({ started: true, message: '授权轮询进行中' });
        loginPoll = { done: false, startedAt: Date.now() };
        const cfg = ctx.getData();
        execFile(cliPath(cfg), ['login', 'poll-token', '-j'], { timeout: 11 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
            let ok = true, msg = '授权完成';
            const text = String(stdout || '');
            const start = text.indexOf('{');
            let json = null;
            try { json = JSON.parse(text.slice(start)); } catch (e) { /* 无 JSON 视为失败 */ }
            if (err && !(json && (json.success || json.data))) {
                ok = false;
                msg = (json && json.error && json.error.message) || (err ? err.message : '授权失败');
            }
            loginPoll = { done: true, ok, message: String(msg).slice(0, 200), at: new Date().toISOString() };
            ctx.log('扫码授权:', msg);
            setTimeout(() => { loginPoll = null; }, 5 * 60 * 1000);
        });
        res.json({ started: true });
    });
    ctx.app.get('/api/plugins/qq-channel-watch/login/poll-status', (req, res) => {
        res.json({ polling: !!(loginPoll && !loginPoll.done), ...(loginPoll || {}) });
    });

    // 自适应轮询：每 30s 检查一次是否到点，间隔配置改动无需重启即生效
    let lastPoll = Date.now();
    const tick = setInterval(() => {
        try {
            const cfg = ctx.getData();
            if (cfg.enabled === false) return;
            const iv = (parseInt(cfg.pollInterval, 10) || 10) * 60 * 1000;
            if (Date.now() - lastPoll >= iv) {
                lastPoll = Date.now();
                runIssuePipeline(ctx).then(r => {
                    if (!r.ok) ctx.log('自动轮询失败:', r.error);
                    else if (r.created || r.skipped) ctx.log('自动轮询: 建 Issue', r.created, '条，跳过', r.skipped, '条');
                }).catch(e => ctx.log('自动轮询异常:', e.message));
            }
        } catch (e) { /* 定时器内异常不外抛 */ }
    }, 30 * 1000);
    tick.unref && tick.unref();

    // 面板已填机器人凭证 → 自动连接 WS 网关（@ 触发）
    const cfg0 = ctx.getData();
    if (cfg0.appId && cfg0.clientSecret) startWS(ctx);

    ctx.onExport = null;
};
