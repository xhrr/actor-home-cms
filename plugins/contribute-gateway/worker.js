/**
 * Pages Function：公共站投稿提交端（POST /api/contribute）
 * 由 contribute-gateway 插件在导出时生成到 dist/functions/api/contribute.js，
 * 随内容仓库推送自动部署到 Cloudflare Pages（与 comment-gateway 的留言提交端同构）。
 *
 * 前置：Cloudflare Pages 项目需绑定 R2 桶为环境变量 BUCKET（站点设置 → 函数 → R2 存储桶绑定）。
 *
 * 流程：同源校验 → 限频 → 校验字段与图片 → 图片经 R2 binding 直传（key 沿用站内日期目录风格）
 *       → 组装 type: album / works / append 格式正文 → 建 GitHub Issue（待审标签）
 *       → 站长改 approved → github-issues 插件固化 → 自动导出部署。
 * append：补充已有内容的图片——按 `id:` 定位实体（a-xxxx 写真集 / w-xxxx 作品），追加到已有图片之后。
 */

const TYPE_RE = /^(album|works|append)$/;
// 目标实体稳定 ID：a-xxxx（写真集）/ w-xxxx（作品）；也接受含 ?album=/?work= 的详情页链接
const TARGET_ID_RE = /^[wa]-[A-Za-z0-9_-]{2,40}$/;
const IMAGE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_IMAGES = 30;
const MAX_FILE_MB = 12;

// 导出时由 contribute-gateway 插件按后台配置替换
const REPO = '__ISSUES_REPO__';
const PENDING_LABEL = '__PENDING_LABEL__';
const PUBLIC_BASE = '__PUBLIC_BASE__';
const KEY_PREFIX = '__KEY_PREFIX__';

const MAX_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

/** 同源校验：Origin/Referer 的 host 与请求 host 一致即放行 */
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

// isolate 内尽力而为的频率限制（与留言提交端同口径）
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

const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** github-issues 固化格式：与导出 README 模板逐字段对齐；空值行不输出 */
function buildBody(type, f, urls, posterIndex) {
    const lines = [`type: ${type}`];
    const put = (k, v) => { if (v) lines.push(`${k}: ${v}`); };
    if (type === 'append') {
        // 补充已有内容：只需目标 id + 图片；标题不可修改，链接/作者等留空则不覆盖
        put('id', f.targetId);
        put('author', f.author);
        put('date', f.date);
        put('sourceUrl', f.sourceUrl);
    } else if (type === 'album') {
        put('date', f.date);
        put('title', f.title);
        put('author', f.author);
        put('sourceUrl', f.sourceUrl);
    } else {
        put('category', f.category);
        put('title', f.title);
        put('year', f.year);
        put('director', f.director);
        put('role', f.role);
        put('synopsis', f.synopsis);
        put('sourceUrl', f.sourceUrl);
        put('poster', urls[posterIndex] || urls[0] || '');
    }
    lines.push('images:');
    urls.forEach(u => lines.push(`  - ${u}`));
    return lines.join('\n');
}

export async function onRequestPost({ request, env }) {
    if (!sameOrigin(request)) return json({ error: '来源校验失败' }, 403);

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (rateLimited(ip, Date.now())) return json({ error: '提交太频繁，请稍后再试' }, 429);

    const bucket = env && env.BUCKET;
    if (!bucket || typeof bucket.put !== 'function') {
        console.error('[contribute-gateway] R2 binding BUCKET 未配置');
        return json({ error: '提交端暂未配置，请稍后再试' }, 500);
    }

    let form;
    try { form = await request.formData(); } catch (e) { return json({ error: '请求格式错误' }, 400); }

    const type = String(form.get('type') || '').trim();
    if (!TYPE_RE.test(type)) return json({ error: '投稿类型无效' }, 400);

    // 文本字段：压平换行 + 限长（固化端会二次校验）
    const f = {
        title: clean(form.get('title'), 60),
        date: clean(form.get('date'), 10),
        author: clean(form.get('author'), 40),
        category: clean(form.get('category'), 20),
        year: clean(form.get('year'), 10),
        director: clean(form.get('director'), 40),
        role: clean(form.get('role'), 40),
        synopsis: clean(form.get('synopsis'), 300),
        sourceUrl: clean(form.get('sourceUrl'), 300),
        targetId: clean(form.get('targetId'), 300)
    };
    if (!f.title && type !== 'append') return json({ error: '标题必填' }, 400);
    if (type === 'append') {
        // 目标 ID：既接受裸 ID，也接受含 ?album=/?work= 的详情页链接
        let tid = f.targetId;
        if (/^https?:\/\//i.test(tid)) {
            try {
                const u = new URL(tid);
                tid = (u.searchParams.get('album') || u.searchParams.get('work') || '').trim();
            } catch (e) { tid = ''; }
        }
        if (!tid) return json({ error: '请填写要补充的内容 ID（详情页链接或 a-xxxx / w-xxxx）' }, 400);
        if (!TARGET_ID_RE.test(tid)) return json({ error: '内容 ID 格式无效（应为 a-xxxx / w-xxxx）' }, 400);
        f.targetId = tid;
    }
    if (type === 'album' && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return json({ error: '请选择发帖日期' }, 400);
    if (type === 'album' && !f.author) return json({ error: '请填写作者 / 摄影师' }, 400);
    if ((type === 'album' || type === 'works') && !/^https?:\/\//i.test(f.sourceUrl)) return json({ error: '请填写原始链接（http/https 开头）' }, 400);
    if (type === 'works') {
        if (!f.category) return json({ error: '请选择分类' }, 400);
        if (!f.year) return json({ error: '请填写年份' }, 400);
        if (!f.role) return json({ error: '请填写饰演角色' }, 400);
        if (!f.synopsis) return json({ error: '请填写简介' }, 400);
    }

    const files = form.getAll('images').filter(v => v && typeof v === 'object' && typeof v.arrayBuffer === 'function');
    if (!files.length) return json({ error: '至少上传一张图片' }, 400);
    if (files.length > MAX_IMAGES) return json({ error: `图片最多 ${MAX_IMAGES} 张` }, 400);

    let posterIndex = parseInt(form.get('posterIndex'), 10);
    if (!Number.isInteger(posterIndex) || posterIndex < 0 || posterIndex >= files.length) posterIndex = 0;

    // 图片 → R2（binding 直传）
    const urls = [];
    const now = new Date();
    const [y, m, d] = now.toISOString().slice(0, 10).split('-');
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = IMAGE_TYPES[file.type];
        if (!ext) return json({ error: `第 ${i + 1} 张图片格式不支持（仅 webp/jpg/png）` }, 400);
        if (file.size > MAX_FILE_MB * 1024 * 1024) return json({ error: `第 ${i + 1} 张图片超过 ${MAX_FILE_MB}MB` }, 400);
        const key = `${KEY_PREFIX}/${y}/${m}/${d}/${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${i + 1}.${ext}`;
        try {
            await bucket.put(key, await file.arrayBuffer(), { contentType: file.type });
        } catch (e) {
            console.error('[contribute-gateway] R2 上传失败', e.message);
            return json({ error: `第 ${i + 1} 张图片上传失败，请稍后再试` }, 502);
        }
        urls.push(`https://${PUBLIC_BASE}/${key}`);
    }

    const token = String((env && env.GITHUB_TOKEN) || '').trim();
    if (!token) {
        console.error('[contribute-gateway] GITHUB_TOKEN 未配置');
        return json({ error: '提交端暂未配置，请稍后再试' }, 500);
    }

    const ghHeaders = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'actor-home-contribute-gateway',
        'Content-Type': 'application/json'
    };

    try {
        // 待审标签不存在时预建（已存在返回 422，属预期）
        const labelRes = await fetch(`https://api.github.com/repos/${REPO}/labels/${encodeURIComponent(PENDING_LABEL)}`, {
            method: 'POST', headers: ghHeaders,
            body: JSON.stringify({ name: PENDING_LABEL, color: '9370db' })
        });
        if (!labelRes.ok && labelRes.status !== 422) console.error('[contribute-gateway] 预建标签失败', labelRes.status);

        const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
            method: 'POST', headers: ghHeaders,
            body: JSON.stringify({
                title: `投稿待审 [${type}] ${f.title || f.targetId || '补充图片'}`,
                body: buildBody(type, f, urls, posterIndex),
                labels: [PENDING_LABEL]
            })
        });
        if (!res.ok) {
            console.error('[contribute-gateway] 建 Issue 失败', res.status, (await res.text()).slice(0, 200));
            return json({ error: '提交失败，请稍后再试' }, 502);
        }
        const issue = await res.json();
        return json({ success: true, pending: true, issueNumber: issue.number, message: '投稿已提交，审核通过后上线' });
    } catch (e) {
        console.error('[contribute-gateway] GitHub 请求异常', e.message);
        return json({ error: '提交失败，请稍后再试' }, 502);
    }
}
