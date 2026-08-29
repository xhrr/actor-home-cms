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
    schedule: 'schedule', 行程: 'schedule'
};

function parseIssueBody(body) {
    const data = {};
    let listKey = null;
    const lines = String(body || '').split(/\r?\n/);

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        const listItem = line.match(/^[-*]\s+(.+)$/);
        if (listItem && listKey) {
            data[listKey].push(listItem[1].trim());
            continue;
        }

        const kv = line.match(/^([a-zA-Z\u4e00-\u9fff]+)\s*[:：]\s*(.*)$/);
        if (!kv) continue;

        const key = kv[1].trim().toLowerCase();
        const value = kv[2].trim();

        if (key === 'images' || key === 'photos' || key === '图片') {
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

    if (!data.type) {
        // 兼容“标题：新增作品：xxx”这种写法
        return data;
    }
    return data;
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

function applyIssueToConfig(config, parsed) {
    const type = normalizeType(parsed.type);
    if (!type) throw new Error('未知 type: ' + parsed.type);

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
            synopsis: parsed.synopsis || parsed.summary || '',
            images: parsed.images || []
        });
        return `作品「${parsed.title || '未命名'}」已添加到「${category}」`;
    }

    if (type === 'album') {
        config.gallery = config.gallery || { heading: '写真', albums: [] };
        config.gallery.albums.push({
            title: parsed.title || '新写真集',
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
            summary: parsed.summary || parsed.content || ''
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
            event: parsed.event || parsed.title || ''
        });
        return `行程「${parsed.event || parsed.title || '未命名'}」已添加`;
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
            const parsed = parseIssueBody(issue.body);
            parsed.type = normalizeType(parsed.type || issue.title.match(/新增(作品|写真|动态|荣誉|行程)[:：]?\s*(.*)/)?.[1] || '');
            if (!parsed.type) {
                messages.push(`#${issue.number} 无法识别类型，已跳过`);
                continue;
            }

            const c = core.readConfig();
            const message = applyIssueToConfig(c, parsed);
            core.writeConfig(c);

            processed.push(issue.number);
            await commentAndClose(repo, token, issue.number, `✅ ${message}\n\n已自动更新并关闭。`);
            updated++;
            messages.push(`#${issue.number} ${message}`);
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
