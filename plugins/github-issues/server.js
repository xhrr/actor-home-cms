/**
 * GitHub Issues 内容更新插件
 * 轮询已审核 Issues，自动更新 config.json 并触发导出/推送。
 */
const path = require('path');
const core = require('../../lib/core');

const TYPE_ALIASES = {
    works: 'works', 作品: 'works', 代表作品: 'works',
    album: 'album', 写真: 'album', 写真集: 'album',
    news: 'news', 动态: 'news',
    awards: 'awards', 荣誉: 'awards', 奖项: 'awards',
    schedule: 'schedule', 行程: 'schedule',
    comment: 'comment', 评论: 'comment', 留言: 'comment',
    // 补充/更新已有内容：按稳定 id 定位条目，把图片追加到已有图片之后
    append: 'append', 追加: 'append', 补充: 'append', 补充图片: 'append', 更新: 'append'
};

function parseIssueBody(body) {
    const blocks = [];
    let data = null;
    let listKey = null;
    const lines = String(body || '').split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // 兼容 "- item" 与 "-item"（连字符后无空格）两种列表写法
        const listItem = line.match(/^[-*]\s*(.+)$/);
        if (listItem && listKey) {
            data[listKey].push(listItem[1].trim());
            continue;
        }
        // 兼容裸链接多行：列表符后直接放一行一个 URL（无 - 前缀），须先于 kv 判断，避免 "https://..." 被误当键值对
        if (listKey && /^https?:\/\/\S+$/.test(line)) {
            data[listKey].push(line);
            continue;
        }

        const kv = line.match(/^([a-zA-Z\u4e00-\u9fff]+)\s*[:：]\s*(.*)$/);
        if (!kv) continue;

        const key = kv[1].trim().toLowerCase();
        const value = kv[2].trim();

        // 多内容块：已有一个带 type 的块时，遇到新的 "type:" 开新块（一条 issue 可含多条内容）
        if (key === 'type' && data && data.type) {
            blocks.push(data);
            data = null;
            listKey = null;
        }
        if (!data) data = {};

        if (key === 'title') {
            // 多行标题：把后续连续的文本行并入标题（空格连接）；遇到下一个键值对/列表项/URL/空行即停；
            // 纯话题残留行（[#马倩倩] / #马倩倩）跳过不并入。展示层负责超长截断。
            listKey = null;
            const parts = [value];
            while (i + 1 < lines.length) {
                const nx = lines[i + 1].trim();
                if (!nx) break;
                if (/^\[?#[^\[\]#]+\]?$/.test(nx)) { i++; continue; } // 话题行
                if (/^[a-zA-Z\u4e00-\u9fff]+\s*[:：]/.test(nx)) break; // 下一键值对
                if (/^[-*]\s*/.test(nx)) break; // 列表项
                if (/^https?:\/\/\S+$/.test(nx)) break; // 裸 URL
                parts.push(nx);
                i++;
            }
            data.title = parts.join(' ');
        } else if (key === 'images' || key === 'photos' || key === '图片') {
            listKey = 'images';
            data.images = value ? [value] : [];
        } else if (key === 'image' || key === '封面') {
            listKey = null;
            data.images = value ? [value] : [];
            if (key === '封面') data.cover = value;
        } else {
            listKey = null;
            data[key] = value;
        }
    }
    if (data) blocks.push(data);
    if (!blocks.length) blocks.push({});
    // 单块保持历史返回形态（对象），多块返回数组
    return blocks.length === 1 ? blocks[0] : blocks;
}

function normalizeType(type) {
    return TYPE_ALIASES[String(type || '').trim().toLowerCase()] || null;
}

// 把各种写法统一成 owner/repo，供 GitHub API 使用：
// "https://github.com/xhrr/QMQ-SGLXQ.git" / "git@github.com:xhrr/QMQ-SGLXQ.git" / "xhrr/QMQ-SGLXQ"
function normalizeRepo(repo) {
    let r = String(repo || '').trim().replace(/\.git$/, '');
    r = r.replace(/^https?:\/\/github\.com\//i, '');
    r = r.replace(/^git:\/\/github\.com\//i, '');
    r = r.replace(/^git@github\.com:/i, '');
    r = r.replace(/\/+$/, '');
    return r;
}

/** 目标 id 归一：支持裸 id（a-xxxx / w-xxxx）或含 ?album=/?work= 的详情页 URL */
function normalizeTargetId(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) {
        try {
            const u = new URL(s);
            const v = u.searchParams.get('album') || u.searchParams.get('work');
            return v ? v.trim().slice(0, 40) : '';
        } catch (e) { return ''; }
    }
    return s.slice(0, 40);
}

/** 按稳定 id 在 config 中定位带图条目（写真集 / 作品） */
function findEntryById(config, id) {
    const albums = (config.gallery && config.gallery.albums) || [];
    const album = albums.find(a => a && a.id === id);
    if (album) return { kind: 'album', entry: album };
    for (const cat of (config.works && config.works.categories) || []) {
        for (const it of (cat.items || [])) {
            if (it && it.id === id) return { kind: 'works', entry: it };
        }
    }
    return null;
}

// 追加时可携带的元数据补丁：entryKey <- 解析器小写键候选。
// 仅覆盖本次明确提供且非空的字段，不做结构变更（分类迁移等需另行处理）。
// 注意：title 不可通过 append 修改（补充只加图片，标题不动）。
const APPEND_PATCH_KEYS = {
    album: [
        ['author', ['author']],
        ['date', ['date']],
        ['sourceUrl', ['sourceurl', 'source', 'link']]
    ],
    works: [
        ['year', ['year']],
        ['director', ['director']],
        ['role', ['role']],
        ['synopsis', ['synopsis', 'summary']],
        ['sourceUrl', ['sourceurl', 'source', 'link']],
        ['type', ['typename', 'worktype']]
    ]
};

/** 取补丁值：按候选小写键取第一个非空值 */
function patchValue(parsed, keys) {
    for (const k of keys) {
        const v = parsed[k];
        if (v !== undefined && String(v).trim() !== '') return String(v).trim();
    }
    return '';
}

function applyIssueToConfig(config, parsed, issueNumber) {
    const type = normalizeType(parsed.type);
    if (!type) throw new Error('未知 type: ' + parsed.type);

    if (type === 'comment') {
        // 审批制静态评论：昵称/内容/所属页，可选 replyTo（楼中楼）。渲染端全量转义，这里只做长度与必填约束
        const page = String(parsed.page || '').trim().slice(0, 40);
        if (!page) throw new Error('评论缺少所属页面（page）');
        const content = String(parsed.content || '').trim().slice(0, 500);
        if (!content) throw new Error('评论内容为空');
        config.comments = config.comments || {};
        config.comments[page] = config.comments[page] || [];
        const entry = {
            id: 'i-' + issueNumber,
            n: String(parsed.nickname || '').trim().slice(0, 20) || '马铃薯',
            t: content,
            d: String(parsed.date || new Date().toISOString().slice(0, 10)).slice(0, 10)
        };
        const replyTo = String(parsed.replyto || '').trim().slice(0, 24);
        if (replyTo) entry.replyTo = replyTo;
        config.comments[page].push(entry);
        return `评论已收录（${page}，第 ${config.comments[page].length} 条）`;
    }

    if (type === 'works') {
        const category = (parsed.category || parsed.categories || '未分类').trim();
        let cat = config.works.categories.find(c => c.name === category);
        if (!cat) {
            cat = { name: category, items: [] };
            config.works.categories.push(cat);
        }
        cat.items.push({
            title: parsed.title || '',
            role: parsed.role || '',
            year: parsed.year || '',
            type: parsed.typeName || parsed.workType || '',
            director: parsed.director || '',
            poster: parsed.poster || parsed.image || (parsed.images && parsed.images[0]) || '',
            sourceUrl: parsed.sourceurl || parsed.source || parsed.link || '',
            synopsis: parsed.synopsis || parsed.summary || '',
            images: parsed.images || []
        });
        return `作品「${parsed.title || '未命名'}」已添加到「${category}」`;
    }

    if (type === 'album') {
        config.gallery = config.gallery || { heading: '写真', albums: [] };
        // 发帖日期（年月日）：宽松归一 YYYY-MM-DD（兼容 2026.09.06 / 2026/09/06 写法），格式不符不落
        const rawDate = String(parsed.date || '').trim();
        const normDate = rawDate.replace(/[./]/g, '-');
        config.gallery.albums.push({
            title: parsed.title || '新写真集',
            date: /^\d{4}-\d{2}-\d{2}$/.test(normDate) ? normDate : '',
            cover: parsed.cover || (parsed.images && parsed.images[0]) || '',
            // 解析器会把 key 转为小写：sourceUrl -> sourceurl；兼容 link/source
            author: parsed.author || '',
            sourceUrl: parsed.sourceurl || parsed.source || parsed.link || '',
            images: parsed.images || []
        });
        return `写真集「${parsed.title || '未命名'}」已添加` + (parsed.author ? `（作者：${parsed.author}）` : '');
    }

    if (type === 'news') {
        config.plugins = config.plugins || { enabled: [], data: {} };
        config.plugins.data = config.plugins.data || {};
        const data = config.plugins.data['actor-news'] = config.plugins.data['actor-news'] || { heading: '最新动态', items: [] };
        data.items.push({
            date: parsed.date || '',
            title: parsed.title || '',
            summary: parsed.summary || parsed.content || '',
            sourceUrl: parsed.sourceurl || parsed.source || parsed.link || ''
        });
        return `动态「${parsed.title || '未命名'}」已添加`;
    }

    if (type === 'awards') {
        config.plugins = config.plugins || { enabled: [], data: {} };
        config.plugins.data = config.plugins.data || {};
        const data = config.plugins.data['actor-awards'] = config.plugins.data['actor-awards'] || { heading: '荣誉奖项', items: [] };
        data.items.push({
            year: parsed.year || '',
            name: parsed.name || parsed.title || '',
            org: parsed.org || parsed.organization || '',
            work: parsed.work || ''
        });
        return `荣誉「${parsed.name || parsed.title || '未命名'}」已添加`;
    }

    if (type === 'schedule') {
        config.plugins = config.plugins || { enabled: [], data: {} };
        config.plugins.data = config.plugins.data || {};
        const data = config.plugins.data['actor-schedule'] = config.plugins.data['actor-schedule'] || { heading: '近期行程', items: [] };
        data.items.push({
            date: parsed.date || '',
            city: parsed.city || '',
            event: parsed.event || parsed.title || '',
            sourceUrl: parsed.sourceurl || parsed.source || parsed.link || ''
        });
        return `行程「${parsed.event || parsed.title || '未命名'}」已添加`;
    }

    if (type === 'append') {
        // 补充已有内容：按稳定 id 定位条目，图片追加到已有图片之后（同 id 去重）
        const targetId = normalizeTargetId(parsed.id || parsed.target || parsed.targetid || parsed.targetId);
        if (!targetId) throw new Error('缺少目标 id（id 字段，可填实体 ID 或详情页链接）');
        const hit = findEntryById(config, targetId);
        if (!hit) throw new Error(`未找到 id 为 ${targetId} 的内容`);
        const box = hit.entry;
        const incoming = (parsed.images || [])
            .map(u => String(u || '').trim())
            .filter(u => /^https?:\/\//i.test(u));
        if (!incoming.length) throw new Error('未提供图片（images）');

        const existing = Array.isArray(box.images) ? box.images : [];
        const seen = new Set(existing);
        const added = [];
        for (const u of incoming) {
            if (!seen.has(u)) { seen.add(u); added.push(u); }
        }
        if (!added.length) return `「${box.title || targetId}」未新增图片（均已存在）`;

        box.images = existing.concat(added);
        // 可选元数据补丁：仅覆盖本次明确提供的字段（空值不动）
        for (const [entryKey, candidates] of (APPEND_PATCH_KEYS[hit.kind] || [])) {
            const raw = patchValue(parsed, candidates);
            if (!raw) continue;
            if (entryKey === 'date') {
                const norm = raw.replace(/[./]/g, '-');
                if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) box.date = norm;
            } else if (entryKey === 'sourceUrl') {
                if (/^https?:\/\//i.test(raw)) box.sourceUrl = raw.slice(0, 300);
            } else {
                box[entryKey] = raw.slice(0, 300);
            }
        }
        // 首图兜底：目标原先没有封面/海报时，用本次首张补齐
        if (hit.kind === 'album' && !box.cover) box.cover = added[0];
        if (hit.kind === 'works' && !box.poster) box.poster = added[0];

        const label = hit.kind === 'album' ? '写真集' : '作品';
        return `已为${label}「${box.title || targetId}」追加 ${added.length} 张图片（现共 ${box.images.length} 张）`;
    }

    throw new Error('不支持的 type: ' + type);
}

async function githubFetch(repo, token, url, options = {}) {
    const response = await fetch(`https://api.github.com${url}`, {
        method: options.method || 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'Actor-CMS',
            'Content-Type': 'application/json'
        },
        body: options.body || undefined
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    return response.json();
}

async function commentAndClose(repo, token, issueNumber, message) {
    const commentUrl = `/repos/${repo}/issues/${issueNumber}/comments`;
    await githubFetch(repo, token, commentUrl, {
        method: 'POST',
        body: JSON.stringify({ body: message })
    });
    const closeUrl = `/repos/${repo}/issues/${issueNumber}`;
    await githubFetch(repo, token, closeUrl, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' })
    });
}

async function triggerDeploy(app) {
    try {
        const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
        const exportRes = await fetch(`${base}/api/export`, { method: 'POST' });
        const exportBody = await exportRes.text().catch(() => '');
        if (!exportRes.ok) {
            return { ok: false, step: 'export', detail: exportBody.slice(0, 300) };
        }
        const pushRes = await fetch(`${base}/api/plugins/github-deploy/push`, { method: 'POST' });
        const pushBody = await pushRes.text().catch(() => '');
        if (!pushRes.ok) {
            return { ok: false, step: 'push', detail: pushBody.slice(0, 300) };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, step: 'request', detail: e.message };
    }
}

async function checkIssues(ctx) {
    const config = ctx.getData();
    const repo = normalizeRepo(config.repo);
    const token = (config.token || '').trim();
    const label = (config.label || 'approved').trim();

    if (!repo || !token) {
        ctx.setData({ ...config, lastStatus: '未配置 repo/token' });
        return { ok: false, message: '未配置 repo/token' };
    }

    const processed = Array.isArray(config.processed) ? config.processed : [];
    const issues = await githubFetch(repo, token, `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=20`);

    let updated = 0;
    const messages = [];

    for (const issue of issues) {
        if (issue.pull_request) continue;
        if (processed.includes(issue.number)) continue;

        try {
            const raw = parseIssueBody(issue.body);
            const entries = Array.isArray(raw) ? raw : [raw];
            const entryMsgs = [];
            let okAny = false;
            for (const p of entries) {
                try {
                    // 单块时保留标题兜底识别（新增作品/写真/…）；多块各块必须自带 type
                    if (!p.type && entries.length === 1) {
                        p.type = issue.title.match(/新增(作品|写真|动态|荣誉|行程)[:：]?\s*(.*)/)?.[1] || '';
                    }
                    p.type = normalizeType(p.type) || '';
                    if (!p.type) {
                        entryMsgs.push('（缺少 type，已跳过）');
                        continue;
                    }
                    const c = core.readConfig();
                    const message = applyIssueToConfig(c, p, issue.number);
                    core.writeConfig(c);
                    okAny = true;
                    entryMsgs.push(message);
                } catch (e2) {
                    entryMsgs.push('❌ ' + (e2.message || '处理失败'));
                }
            }
            if (!okAny) {
                messages.push(`#${issue.number} 无法识别类型，已跳过`);
                continue;
            }
            processed.push(issue.number);
            const combined = entryMsgs.filter(Boolean).join('\n');
            await commentAndClose(repo, token, issue.number, `✅ ${combined}\n\n已自动更新并关闭。`);
            updated++;
            messages.push(`#${issue.number} ${combined.split('\n').join('；')}`);
        } catch (e) {
            messages.push(`#${issue.number} 处理失败: ${e.message}`);
            await commentAndClose(repo, token, issue.number, `❌ 处理失败：${e.message}`);
            processed.push(issue.number);
        }
    }

    const autoPush = config.autoPush !== false;
    let deployMsg = '未触发部署';
    if (updated > 0 && autoPush) {
        const result = await triggerDeploy(ctx.app);
        deployMsg = result.ok
            ? '已自动导出并推送'
            : `自动部署失败（${result.step}）：${String(result.detail).slice(0, 200)}`;
    }

    const status = `检查完成：更新 ${updated} 条，${deployMsg}`;
    ctx.setData({ ...config, processed, lastStatus: status, lastCheck: new Date().toISOString() });
    return { ok: true, updated, messages, status };
}

module.exports = function (ctx) {
    ctx.app.post('/api/plugins/github-issues/check', async (req, res) => {
        try {
            const result = await checkIssues(ctx);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    ctx.app.get('/api/plugins/github-issues/status', (req, res) => {
        res.json(ctx.getData());
    });

    // 自适应轮询：每 30s 检查一次是否到点，间隔配置改动无需重启即生效
    let lastPoll = Date.now();
    const tick = setInterval(() => {
        const iv = (parseInt((ctx.getData().pollInterval) || '10', 10) || 10) * 60 * 1000;
        if (Date.now() - lastPoll >= iv) {
            lastPoll = Date.now();
            checkIssues(ctx).catch(e => console.error('[github-issues] poll error:', e.message));
        }
    }, 30 * 1000);
    tick.unref && tick.unref();

    ctx.onExport = null;
};
