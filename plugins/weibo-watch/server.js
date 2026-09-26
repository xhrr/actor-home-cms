/**
 * 倩一波日常插件（v2 · 知更数据消费端）
 *
 * 社交数据获取统一由知更（Zhigeng）完成，本插件不再直接抓取微博。
 * 职责：从知更 API 拉取微博博主的新作品 → 筛选行程微博 → LLM 解析为结构化行程
 * （含同项目阶段合并、公告提取）→ 更新到 actor-schedule。
 *
 * 配置：知更地址/口令/博主、关键词、目标月份、AI 凭据。
 * 运行态：processed（已处理 work_id）、lastSync/lastStatus 等在同插件数据内。
 */
const core = require('../../lib/core');

/* ---------------- 通用 ---------------- */

function isScheduleWeibo(text, keyword) {
    const kw = String(keyword || '').trim();
    const list = kw ? kw.split(/[,，\s]+/).filter(Boolean) : ['同步', '更新'];
    const hasKw = list.some(k => text.includes(k));
    const hasMonth = /(\d{1,2})月/.test(text);
    return hasKw && hasMonth && /行程|安排|通告|档期/.test(text);
}

/**
 * 从行程微博文本识别目标月份：优先「同步/更新X月行程」，其次任意「X月行程」，再次正文第一个「X月」。
 * 微博发布时间不定（可能提前一月、提前几天，甚至月初发当月），故月份以微博自述为准，不依赖「当前是几月」。
 * 返回 1-12 或 null。
 */
function extractScheduleMonth(text) {
    const s = String(text || '');
    const m = s.match(/(?:同步|更新)\s*(\d{1,2})\s*月\s*(?:行程|安排|通告|档期)/)
        || s.match(/(\d{1,2})\s*月\s*(?:行程|安排|通告|档期)/)
        || s.match(/(\d{1,2})\s*月/);
    if (!m) return null;
    const month = parseInt(m[1], 10);
    return (month >= 1 && month <= 12) ? month : null;
}

/**
 * 按微博发布时间推断行程年份：目标月份 ≥ 发布月份 → 同年；小于 → 跨到次年。
 * 例：9/21 发「同步9月行程」→ 当年 9 月；12/28 发「同步1月行程」→ 次年 1 月。
 * publish_time 为秒级时间戳（显式按东八区取发布月，与 xhs-gallery-sync 同口径）。
 */
function inferYear(month, publishTime) {
    const sec = Number(publishTime) || 0;
    if (!sec) return new Date().getFullYear();
    const ms = sec > 1e12 ? sec : sec * 1000;
    const d = new Date(ms + 8 * 3600 * 1000);
    const publishMonth = d.getUTCMonth() + 1;
    return month >= publishMonth ? d.getUTCFullYear() : d.getUTCFullYear() + 1;
}

function dedupe(list) {
    return list.filter((w, i, arr) => arr.findIndex(x => x.id === w.id) === i);
}

/* ---------------- 知更 API ---------------- */

function zhigengBase(config) {
    return String(config.zhigengUrl || 'http://127.0.0.1:3223').trim().replace(/\/+$/, '');
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

/** 拉取知更里微博平台的最新作品（page_size 内按发布时间降序） */
async function fetchWeiboWorks(config) {
    const qs = new URLSearchParams({ platform: 'weibo', page: '1', page_size: '50' });
    if (String(config.creatorId || '').trim()) {
        qs.set('creator_id', String(config.creatorId).trim());
    }
    const data = await zhigengFetch(config, '/api/works?' + qs.toString());
    return (data.items || []).map(w => ({
        id: w.work_id,
        text: String(w.description || w.title || '').trim(),
        title: String(w.title || '').trim(),
        publish_time: w.publish_time || 0,
        source_url: w.source_url || ''
    }));
}

/** 知更连通性 + 微博博主列表（面板展示用） */
async function fetchWeiboCreators(config) {
    const data = await zhigengFetch(config, '/api/creators');
    return (data || []).filter(c => c.platform === 'weibo')
        .map(c => ({ id: c.id, uid: c.platform_uid, name: c.display_name || c.platform_uid, status: c.status }));
}

/* ---------------- AI 解析 ---------------- */

/**
 * LLM 解析行程微博正文 → { items: [{date, city, event}], announcement }
 * 默认小米 MiMo（OpenAI 兼容 /chat/completions），后台可配置 baseUrl/key/model。
 */
async function parseWithLLM(text, config, target) {
    const base = String(config.llmBaseUrl || '').trim().replace(/\/+$/, '') || 'https://api.xiaomimimo.com/v1';
    const key = String(config.llmKey || '').trim();
    const model = String(config.llmModel || '').trim() || 'Mimo-V2.5';
    if (!key) throw new Error('未配置 AI Key（插件设置中填写 AI Key）');
    const ty = (target && target.year) || new Date().getFullYear();
    const tm = (target && target.month) || new Date().getMonth() + 1;

    const prompt = `你是演员行程解析助手。把微博行程正文解析为结构化 JSON。目标月份是 ${ty} 年 ${tm} 月（由微博标题「同步${tm}月行程」识别，年份按发布时间推断）。

规则：
1. 只提取 ${ty} 年 ${tm} 月的行程安排；正文中其他月份的安排一律忽略，不要输出。
2. 同一项目的连续阶段（定妆→围读→开机→拍摄→杀青等）合并为一条：date 取第一阶段日期，event 用「 → 」连接各阶段（如「新项目定妆 → 开机 → 杀青」），city 取第一阶段城市。
3. 日期格式 yyyy-MM-dd，年份一律 ${ty}，禁止出现 ${tm} 月以外的日期。
4. 城市：取括号或地名（成都、西安、横店、川渝地区等）；没有则空字符串。
5. 无具体日期只有安排的（如“保密项目定妆3天 → 开机，地点：川渝地区”）：items 返回空数组，摘要写入 announcement，格式以「${tm}月行程公告：」开头，只保留安排主体、省略保密条款。
6. 注意：只要正文包含 ${ty} 年 ${tm} 月的具体日期行程，announcement 一律输出空字符串 ""（不要把正文末尾的补充语句当公告）。
7. 忽略话题标签（#...#）与“同步X月行程：”前缀。正文里若同时出现多个「X月」（如标签日期），只认与目标月份一致的那些日期。

只输出 JSON，不要任何解释或代码块标记：
{"items":[{"date":"${ty}-${String(tm).padStart(2, '0')}-03","city":"成都","event":"新项目定妆 → 开机 → 杀青"}],"announcement":""}`;

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

/* ---------------- 主流程（拉取 → 筛选 → 解析 → 应用） ---------------- */

function markProcessed(config, workId) {
    const processed = Array.isArray(config.processed) ? config.processed : [];
    if (!processed.includes(workId)) processed.push(workId);
    // 只保留最近 500 条，防止无限增长
    config.processed = processed.slice(-500);
}

/**
 * 拉取并筛选未处理的行程微博（不碰 LLM）。
 * 月份来自微博自身（「同步X月行程」），不再与「当前月份/配置月份」比对——
 * 站长发布节奏不定（可能提前一月、也可能月初发当月），以微博自述为准才不漏。
 * 每条命中自带 target（{year, month, label}），不同微博可能指向不同月份，各自独立解析。
 */
async function fetchAndFilter(ctx) {
    const config = ctx.getData();
    const works = await fetchWeiboWorks(config);
    const processed = new Set(Array.isArray(config.processed) ? config.processed : []);
    const hits = dedupe(works
        .filter(w => w.text && isScheduleWeibo(w.text, config.keyword) && !processed.has(w.id))
        .map(w => {
            const month = extractScheduleMonth(w.text);
            if (!month) return null;
            return { ...w, target: { year: inferYear(month, w.publish_time), month, label: `${month}月` } };
        })
        .filter(Boolean));
    return { config, works, hits };
}

/** 完整应用流程：解析全部命中并写入行程，标记已处理（每条用自己的 target） */
async function applyAll(ctx, hits, config) {
    const summary = [];
    let totalAdded = 0, annUpdated = 0;
    for (const hit of hits) {
        const parsed = await parseWithLLM(hit.text, config, hit.target);
        const { added, announcementUpdated } = applyToSchedule(parsed, hit.source_url);
        totalAdded += added;
        if (announcementUpdated) annUpdated++;
        markProcessed(config, hit.id);
        summary.push(`${hit.target.label}：${hit.text.slice(0, 24)}… → ${added} 条行程${announcementUpdated ? ' + 公告' : ''}`);
    }
    return { totalAdded, annUpdated, summary };
}

/* ---------------- 路由 ---------------- */

module.exports = function (ctx) {
    // 知更连通性 + 微博博主列表（面板展示）
    ctx.app.get('/api/plugins/weibo-watch/zhigeng/creators', async (req, res) => {
        try {
            const config = ctx.getData();
            const creators = await fetchWeiboCreators(config);
            res.json({ ok: true, creators });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // AI 连接测试：最小 prompt 验证 llmBaseUrl/llmKey/llmModel 是否可用
    ctx.app.post('/api/plugins/weibo-watch/ai-test', async (req, res) => {
        try {
            const config = ctx.getData();
            const base = String(config.llmBaseUrl || '').trim().replace(/\/+$/, '') || 'https://api.xiaomimimo.com/v1';
            const key = String(config.llmKey || '').trim();
            const model = String(config.llmModel || '').trim() || 'Mimo-V2.5';
            if (!key) return res.status(400).json({ error: '未配置 AI Key' });
            const t0 = Date.now();
            const r = await fetch(base + '/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: '回复两个字：正常' }],
                    temperature: 0
                }),
                signal: AbortSignal.timeout(30000)
            });
            if (!r.ok) {
                const t = await r.text().catch(() => '');
                return res.status(500).json({ error: `AI 接口 HTTP ${r.status}：${t.slice(0, 120)}` });
            }
            const j = await r.json();
            const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
            if (!reply) return res.status(500).json({ error: 'AI 返回无内容：' + JSON.stringify(j).slice(0, 120) });
            res.json({ ok: true, model, baseUrl: base, ms: Date.now() - t0, reply: String(reply).slice(0, 40) });
        } catch (e) {
            res.status(500).json({ error: 'AI 连接失败：' + e.message });
        }
    });

    // 拉取 + 筛选 + AI 解析预览（不写入、不标记）
    ctx.app.post('/api/plugins/weibo-watch/preview', async (req, res) => {
        try {
            const { config, works, hits } = await fetchAndFilter(ctx);
            if (!hits.length) {
                return res.json({
                    ok: true, hit: false,
                    latest: works.slice(0, 5).map(w => (w.title || w.text).slice(0, 40)),
                    message: works.length
                        ? `知更最新 ${works.length} 条微博中没有未处理的行程微博（月份从「同步X月行程」自动识别）`
                        : '知更中暂无微博作品（先在知更里触发一次扫描）'
                });
            }
            const parsedAll = [];
            for (const hit of hits) {
                const parsed = await parseWithLLM(hit.text, config, hit.target);
                parsedAll.push({ weibo: hit, ...parsed });
            }
            const first = parsedAll[0];
            res.json({
                ok: true, hit: true, targetMonth: first.weibo.target.label,
                hits: parsedAll.map(p => ({ id: p.weibo.id, month: p.weibo.target.label, text: p.weibo.text.slice(0, 60), items: (p.items || []).length, hasAnnouncement: !!p.announcement })),
                weibo: { ...first.weibo, text: first.weibo.text.slice(0, 200) },
                items: first.items, announcement: first.announcement
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 拉取 + 解析 + 写入行程（处理所有命中）
    ctx.app.post('/api/plugins/weibo-watch/apply', async (req, res) => {
        try {
            const { config, works, hits } = await fetchAndFilter(ctx);
            if (!hits.length) {
                ctx.setData({ ...config, lastSync: new Date().toISOString(),
                    lastStatus: works.length ? `知更最新 ${works.length} 条中无未处理的行程微博` : '知更中暂无微博作品' });
                return res.json({ ok: true, applied: 0, message: '没有未处理的行程微博' });
            }
            const { totalAdded, annUpdated, summary } = await applyAll(ctx, hits, config);
            ctx.setData({ ...config, lastSync: new Date().toISOString(),
                lastStatus: `处理 ${hits.length} 条，新增 ${totalAdded} 条行程${annUpdated ? ' + ' + annUpdated + ' 条公告' : ''}` });
            res.json({ ok: true, applied: totalAdded, announcementUpdated: annUpdated > 0,
                items: summary.map(s => ({ dateText: s, city: '', event: '' })),
                message: `处理 ${hits.length} 条行程微博，新增 ${totalAdded} 条日程${annUpdated ? '，' + annUpdated + ' 条公告' : ''}` });
        } catch (e) {
            const config = ctx.getData();
            ctx.setData({ ...config, lastError: new Date().toISOString() + ' ' + e.message });
            res.status(500).json({ error: e.message });
        }
    });

    // 状态（配置掩码 + 知更连通性）
    ctx.app.get('/api/plugins/weibo-watch/status', async (req, res) => {
        const d = ctx.getData();
        let zhigeng = { ok: false, creators: [] };
        try {
            zhigeng = { ok: true, creators: await fetchWeiboCreators(d) };
        } catch (e) {
            zhigeng.error = e.message;
        }
        res.json({
            // 空值语义：keyword 空串 = 用默认关键词（同步/更新）
            zhigengUrl: d.zhigengUrl || 'http://172.23.0.1:3223',
            zhigengToken: d.zhigengToken ? '***已配置***' : '',
            creatorId: d.creatorId || '',
            keyword: d.keyword === undefined ? '同步,更新' : d.keyword,
            autoSync: d.autoSync !== false,
            llmKey: d.llmKey ? '***已配置***' : '',
            processed: Array.isArray(d.processed) ? d.processed.length : 0,
            lastSync: d.lastSync, lastStatus: d.lastStatus, lastError: d.lastError,
            zhigeng
        });
    });

    // 自动同步：每小时检查一次知更新帖（与图集同步同节奏），命中即解析写入
    ctx.cron('auto-sync', 60 * 60 * 1000, async () => {
        try {
            const config = ctx.getData();
            if (config.autoSync === false) return;
            if (!config.zhigengToken) return; // 未配置知更口令则不自动跑
            const { config: cfg, hits } = await fetchAndFilter(ctx);
            if (hits.length) {
                const { totalAdded, annUpdated } = await applyAll(ctx, hits, cfg);
                ctx.log('自动同步:', hits.map(h => h.target.label).join('/'), '命中', hits.length, '条，新增', totalAdded,
                        '条', annUpdated ? `+ ${annUpdated} 条公告` : '');
            }
            ctx.setData({ ...cfg, lastSync: new Date().toISOString(),
                lastStatus: hits.length
                    ? `命中 ${hits.length} 条行程微博（${hits.map(h => h.target.label).join('、')}），已解析应用`
                    : '知更中暂无未处理的行程微博' });
        } catch (e) {
            ctx.log('自动同步失败:', e.message);
        }
    });

    ctx.onExport = null;
};
