/**
 * Pages Function：公共站评论提交端（POST /api/comments）
 * 由 comment-gateway 插件在导出时生成到 dist/functions/api/comments.js，
 * 随内容仓库推送自动部署到 Cloudflare Pages（Functions 与静态站同源，前端零配置）。
 *
 * 流转：同源校验 → 频率/长度限制 → 建 GitHub Issue（待审标签）
 *       → 站长把标签改为 approved → github-issues 插件固化进 config → 导出上线。
 * 审批闸是防滥用的最终防线，这里的限制只用于挡低成本的脚本刷量。
 */

const PAGE_RE = /^(news|album-[A-Za-z0-9_-]{1,32}|work-[A-Za-z0-9_-]{1,32})$/;
const REPLY_RE = /^[A-Za-z0-9-]{1,24}$/;

// 导出时由 comment-gateway 插件按后台配置替换
const REPO = '__ISSUES_REPO__';
const PENDING_LABEL = '__PENDING_LABEL__';
// 评论功能一键开关：后台「评论管理」关闭时导出注入 'false'（原始文件缺省为开启）
const ENABLED = '__COMMENTS_ENABLED__' !== 'false';

const MAX_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

/** 同源校验：Origin/Referer 的 host 与请求 host 一致即放行（自动覆盖自定义域与 pages.dev 预览域） */
function sameOrigin(request) {
    const host = request.headers.get('host');
    if (!host) return false;
    let source = request.headers.get('origin') || '';
    if (!source) {
        const referer = request.headers.get('referer');
        if (referer) { try { source = new URL(referer).origin; } catch (e) { /* 无效 referer */ } }
    }
    if (!source) return false;
    try { return new URL(source).host === host; } catch (e) { return false; }
}

// isolate 内尽力而为的频率限制：isolate 回收即清零，真实限速可叠加 Cloudflare WAF 规则
const hits = new Map();

function rateLimited(ip, now) {
    const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 4000) {
        for (const [k, v] of hits) { if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k); }
    }
    return recent.length > MAX_PER_WINDOW;
}

export async function onRequestPost({ request, env }) {
    if (!ENABLED) return json({ error: '评论功能已关闭' }, 403);
    if (!sameOrigin(request)) return json({ error: '来源校验失败' }, 403);

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (rateLimited(ip, Date.now())) return json({ error: '提交太频繁，请稍后再试' }, 429);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }

    // 口径与 CMS 端 /api/comments、github-issues comment 类型一致；page 收紧为已知展示键
    const page = String(body.page || '').trim().slice(0, 40);
    const content = String(body.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!PAGE_RE.test(page)) return json({ error: '页面标识无效' }, 400);
    if (!content) return json({ error: '评论内容为空' }, 400);

    const nickname = String(body.nickname || '').replace(/\s+/g, ' ').trim().slice(0, 20) || '马铃薯';
    const replyTo = String(body.replyTo || '').trim().slice(0, 24);
    if (replyTo && !REPLY_RE.test(replyTo)) return json({ error: '回复目标无效' }, 400);

    const token = String((env && env.GITHUB_TOKEN) || '').trim();
    if (!token) {
        console.error('[comment-gateway] GITHUB_TOKEN 未配置');
        return json({ error: '提交端暂未配置，请稍后再试' }, 500);
    }

    // 单行正文：github-issues 解析器按「key: value」逐行读取，换行会截断内容
    const lines = [
        'type: comment',
        `page: ${page}`,
        `nickname: ${nickname}`,
        `content: ${content}`,
        `date: ${new Date().toISOString().slice(0, 10)}`
    ];
    if (replyTo) lines.push(`replyto: ${replyTo}`);

    const ghHeaders = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'actor-home-comment-gateway',
        'Content-Type': 'application/json'
    };

    try {
        // 待审标签不存在时预建（已存在返回 422，属预期；失败不阻断，建 Issue 时 GitHub 会自动补建）
        const labelRes = await fetch(`https://api.github.com/repos/${REPO}/labels/${encodeURIComponent(PENDING_LABEL)}`, {
            method: 'POST',
            headers: ghHeaders,
            body: JSON.stringify({ name: PENDING_LABEL, color: 'e9967a' })
        });
        if (!labelRes.ok && labelRes.status !== 422) {
            console.error('[comment-gateway] 预建标签失败', labelRes.status);
        }

        const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
            method: 'POST',
            headers: ghHeaders,
            body: JSON.stringify({
                title: `留言待审 [${page}]`,
                body: lines.join('\n'),
                labels: [PENDING_LABEL]
            })
        });
        if (!res.ok) {
            console.error('[comment-gateway] 建 Issue 失败', res.status, (await res.text()).slice(0, 200));
            return json({ error: '提交失败，请稍后再试' }, 502);
        }
        return json({ success: true, pending: true, message: '留言已提交，审核通过后展示' });
    } catch (e) {
        console.error('[comment-gateway] GitHub 请求异常', e.message);
        return json({ error: '提交失败，请稍后再试' }, 502);
    }
}
