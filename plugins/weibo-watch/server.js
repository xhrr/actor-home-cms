/**
 * 微博行程监控插件（AI 解析版）
 * 抓取指定微博账号的微博（通过浏览器 Cookie 注入），筛选“同步X月行程”类微博，
 * 交给 LLM（默认小米 MiMo V2.5）解析为结构化行程（含同项目阶段合并、公告提取），更新到 actor-schedule。
 */
const core = require('../../lib/core');

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const MAX_PAGES = 3; // 最多抓取 3 页（每页约 10 条）

/* ---------------- 通用 ---------------- */

function stripHtml(html) {
    return String(html || '')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/\u200b/g, '')
        .trim();
}

function normalizeUid(uid) {
    return String(uid || '').trim().replace(/[^0-9]/g, '');
}

/** 判断是否为行程微博：标题含“同步/更新/行程”且提到月份（如 8月） */
function isScheduleWeibo(text, keyword) {
    const kw = String(keyword || '').trim();
    const list = kw ? kw.split(/[,，\s]+/).filter(Boolean) : ['同步', '更新'];
    const hasKw = list.some(k => text.includes(k));
    const hasMonth = /(\d{1,2})月/.test(text);
    return hasKw && hasMonth && /行程|安排|通告|档期/.test(text);
}

/* ---------------- AI 解析 ---------------- */

/**
 * LLM 解析行程微博正文 → { items: [{date, city, event}], announcement }
 * 默认小米 MiMo（OpenAI 兼容 /chat/completions），后台可配置 baseUrl/key/model。
 */
async function parseWithLLM(text, config) {
    const base = String(config.llmBaseUrl || '').trim().replace(/\/+$/, '') || 'https://api.xiaomimimo.com/v1';
    const key = String(config.llmKey || '').trim();
    const model = String(config.llmModel || '').trim() || 'Mimo-V2.5';
    if (!key) throw new Error('未配置 AI 解析 Key（插件设置中填写 AI Key）');
    const currentYear = new Date().getFullYear();

    const prompt = `你是演员行程解析助手。把微博行程正文解析为结构化 JSON。

规则：
1. 提取所有行程安排；同一项目的连续阶段（定妆→围读→开机→拍摄→杀青等）合并为一条：date 取第一阶段日期，event 用「 → 」连接各阶段（如「新项目定妆 → 开机 → 杀青」），city 取第一阶段城市。
2. 日期格式 yyyy-MM-dd。年份基准：本年 ${currentYear}；仅当 12 月发布次年 1 月行程时跨到 ${currentYear + 1} 年；其余一律用本年，禁止把 1 月行程误判为明年。
3. 城市：取括号或地名（成都、西安、横店、川渝地区等）；没有则空字符串。
4. 无具体日期只有安排的（如“保密项目定妆3天 → 开机，地点：川渝地区”）：items 返回空数组，摘要写入 announcement，格式以「N月行程公告：」开头（N 为正文出现的月份），只保留安排主体、省略保密条款。
5. 注意：只要正文包含具体日期行程，announcement 一律输出空字符串 ""（不要把正文末尾的补充语句当公告）。
6. 忽略话题标签（#...#）与“同步X月行程：”前缀。

只输出 JSON，不要任何解释或代码块标记：
{"items":[{"date":"2026-07-03","city":"成都","event":"新项目定妆 → 开机 → 杀青"}],"announcement":""}`;

    const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: String(text || '') }
            ],
            temperature: 0.1,
            // max_tokens 不设限：mimo-v2.5 支持 1M 上下文，推理内容长时不会截断正式输出
        }),
        signal: AbortSignal.timeout(45000)
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error('AI 接口错误（HTTP ' + res.status + '）: ' + errText.slice(0, 200));
    }
    const body = await res.json();
    const content = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (!content) throw new Error('AI 解析无返回: ' + JSON.stringify(body).slice(0, 200));

    // 兼容 markdown 代码块 / 裸 JSON / 前后说明文字
    const fenced = String(content).match(/```(?:json)?\s*([\s\S]*?)```/);
    const bare = String(content).match(/\{[\s\S]*\}/);
    let parsed;
    try {
        parsed = JSON.parse(fenced ? fenced[1] : (bare ? bare[0] : content));
    } catch (e) {
        throw new Error('AI 返回无法解析为 JSON: ' + String(content).slice(0, 200));
    }
    return {
        items: (Array.isArray(parsed.items) ? parsed.items : []).map(it => ({
            date: String(it.date || '').trim(),
            city: String(it.city || '').trim(),
            event: String(it.event || '').trim()
        })),
        announcement: String(parsed.announcement || '').trim()
    };
}

/* ---------------- 抓取 ---------------- */

/** 抓取指定 uid 的最近微博（带 cookie），返回 [{id, text, created_at, pics}] */
async function fetchWeibos(config, maxPages) {
    const uid = normalizeUid(config.uid);
    if (!uid) throw new Error('未配置微博 UID');
    const cookie = (config.cookie || '').trim();
    if (!cookie) throw new Error('未配置浏览器 Cookie（打开 m.weibo.cn 后从开发者工具复制任意请求的 Cookie 头）');

    const results = [];
    let sinceId = '';
    for (let page = 0; page < (maxPages || MAX_PAGES); page++) {
        const url = `https://m.weibo.cn/api/container/getIndex?containerid=230283${uid}&page_type=03${sinceId ? '&since_id=' + sinceId : ''}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': UA_MOBILE,
                'Referer': `https://m.weibo.cn/u/${uid}`,
                'Accept': 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
                'Cookie': cookie
            },
            signal: AbortSignal.timeout(15000)
        });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch (e) { throw new Error(`微博接口响应异常（HTTP ${res.status}），Cookie 可能已失效: ${text.slice(0, 120)}`); }
        if (json.ok !== 1) {
            if (json.ok === -100) throw new Error('微博接口要求登录：Cookie 无效或已过期，请重新从浏览器复制');
            throw new Error('微博接口返回异常: ' + JSON.stringify(json).slice(0, 200));
        }
        const cards = (json.data && json.data.cards) || [];
        const mblogs = [];
        for (const c of cards) {
            if (c.card_type === 9 && c.mblog) mblogs.push(c.mblog);
            if (c.card_group) {
                for (const g of c.card_group) {
                    if (g.card_type === 9 && g.mblog) mblogs.push(g.mblog);
                }
            }
        }
        if (!mblogs.length) break;
        for (const m of mblogs) {
            results.push({
                id: m.id || m.mid || '',
                text: stripHtml(m.text),
                created_at: m.created_at || '',
                pics: ((m.pics || []).map(p => p.large && p.large.url) || []).filter(Boolean)
            });
        }
        sinceId = json.data.since_id || mblogs[mblogs.length - 1].id || '';
        if (!sinceId) break;
        await new Promise(r => setTimeout(r, 800)); // 礼貌限速
    }
    return results;
}

/* ---------------- 写入行程 ---------------- */

function applyToSchedule(parsed, sourceUrl) {
    const src = sourceUrl || '';
    const config = core.readConfig();
    config.plugins = config.plugins || { enabled: [], data: {} };
    config.plugins.data = config.plugins.data || {};
    const data = config.plugins.data['actor-schedule'] = config.plugins.data['actor-schedule'] || { heading: '近期行程', items: [] };
    const existing = new Set((data.items || []).map(it => `${it.date}|${it.city}|${it.event}`));

    let added = 0;
    for (const it of parsed.items || []) {
        const key = `${it.date}|${it.city}|${it.event}`;
        if (existing.has(key)) continue;
        data.items.push({ date: it.date, city: it.city, event: it.event, sourceUrl: src });
        existing.add(key);
        added++;
    }
    // 公告：整段覆盖对应月份公告（取月份前缀）
    let announcementUpdated = false;
    if (parsed.announcement) {
        const monthKey = (parsed.announcement.match(/^(\d{1,2})月/) || [])[1] || '';
        data.announcements = data.announcements || [];
        const idx = monthKey
            ? data.announcements.findIndex(a => String(a.month) === monthKey)
            : data.announcements.length - 1;
        const entry = { month: monthKey || '', text: parsed.announcement, updatedAt: new Date().toISOString(), sourceUrl: src };
        if (idx >= 0) { data.announcements[idx] = entry; } else { data.announcements.push(entry); }
        announcementUpdated = true;
    }
    // 按日期升序存储（前端展示时另行排序）
    data.items.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    core.writeConfig(config);
    return { added, announcementUpdated };
}

/* ---------------- 路由 ---------------- */

module.exports = function (ctx) {
    // 抓取 + AI 解析预览（不写入）
    ctx.app.post('/api/plugins/weibo-watch/preview', async (req, res) => {
        try {
            const config = ctx.getData();
            const weibos = await fetchWeibos(config, MAX_PAGES);
            const target = latestScheduleMonth(config.targetMonth);
            const hits = dedupe(weibos.filter(w => isScheduleWeibo(w.text, config.keyword)));
            if (!hits.length) {
                return res.json({ ok: true, hit: false, latest: weibos.slice(0, 5).map(w => w.text.slice(0, 50)), message: '最近微博中没有匹配的行程微博' });
            }
            const parsedAll = [];
            for (const hit of hits) {
                const parsed = await parseWithLLM(hit.text, config);
                parsedAll.push({ weibo: { id: hit.id, text: hit.text, date: hit.created_at, pics: hit.pics }, ...parsed });
            }
            const first = parsedAll[0];
            res.json({
                ok: true, hit: true,
                hits: parsedAll.map(p => ({ id: p.weibo.id, text: p.weibo.text.slice(0, 60), items: (p.items || []).length, hasAnnouncement: !!p.announcement })),
                weibo: first.weibo, targetMonth: target.label, ...first
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 抓取 + AI 解析 + 写入行程（处理所有命中的行程微博）
    ctx.app.post('/api/plugins/weibo-watch/apply', async (req, res) => {
        try {
            const config = ctx.getData();
            const weibos = await fetchWeibos(config, MAX_PAGES);
            const target = latestScheduleMonth(config.targetMonth);
            const hits = dedupe(weibos.filter(w => isScheduleWeibo(w.text, config.keyword)));
            if (!hits.length) {
                return res.json({ ok: true, applied: 0, message: '最近微博中没有匹配的行程微博' });
            }
            const processed = Array.isArray(config.processed) ? config.processed : [];
            let totalAdded = 0;
            let annUpdated = 0;
            const summary = [];
            for (const hit of hits) {
                const parsed = await parseWithLLM(hit.text, config);
                const { added, announcementUpdated } = applyToSchedule(parsed, 'https://m.weibo.cn/status/' + hit.id);
                totalAdded += added;
                if (announcementUpdated) annUpdated++;
                if (!processed.includes(hit.id)) processed.push(hit.id);
                const am = (parsed.announcement && parsed.announcement.match(/^(\d{1,2})月/)) || [];
                summary.push(`${am[1] || '?'}月：${added > 0 ? '新增 ' + added + ' 条' : ''}${parsed.announcement ? '公告' : ''}`);
            }
            const parts = [`处理 ${hits.length} 条行程微博`, `新增 ${totalAdded} 条日程`];
            if (annUpdated) parts.push(`${annUpdated} 条公告更新`);
            ctx.setData({ ...config, processed, lastStatus: parts.join('，'), lastSync: new Date().toISOString(), lastWeiboId: hits[0].id });
            res.json({ ok: true, applied: totalAdded, announcementUpdated: annUpdated > 0, summary, message: parts.join('；') });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    ctx.app.get('/api/plugins/weibo-watch/status', (req, res) => {
        const d = ctx.getData();
        res.json({ ...d, cookie: d.cookie ? '***已配置***' : '', llmKey: d.llmKey ? '***已配置***' : '' });
    });

    // 自适应轮询：月底 25 号起每 30 分钟检查一次，当天成功过则跳过
    const TICK = 30 * 60 * 1000;
    const tick = setInterval(async () => {
        try {
            const config = ctx.getData();
            if (config.autoSync === false) return;
            const now = new Date();
            if (now.getDate() < 25) return;
            const last = config.lastSync ? new Date(config.lastSync) : null;
            if (last && last.toDateString() === now.toDateString()) return;
            const weibos = await fetchWeibos(config, MAX_PAGES);
            const target = latestScheduleMonth(config.targetMonth);
            const hits = dedupe(weibos.filter(w => isScheduleWeibo(w.text, config.keyword)));
            if (hits.length) {
                let totalAdded = 0;
                for (const hit of hits) {
                    const parsed = await parseWithLLM(hit.text, config);
                    const { added } = applyToSchedule(parsed, 'https://m.weibo.cn/status/' + hit.id);
                    totalAdded += added;
                }
                ctx.log('月底自动同步:', target.label, '命中', hits.length, '条，新增', totalAdded, '条');
            }
        } catch (e) {
            ctx.log('自动同步失败:', e.message);
        }
    }, TICK);
    tick.unref && tick.unref();

    ctx.onExport = null;
};

/** 按微博 id 去重 */
function dedupe(list) {
    return list.filter((w, i, arr) => arr.findIndex(x => x.id === w.id) === i);
}

/** 目标月份：0 = 当月，1（默认）= 下个月 */
function latestScheduleMonth(cfg) {
    const now = new Date();
    const n = parseInt(cfg, 10);
    const offset = Number.isNaN(n) ? 1 : n;
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, label: `${d.getMonth() + 1}月` };
}