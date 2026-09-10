/**
 * AI 内容审核插件（独立，与 github-issues / 各网关零代码耦合）
 *
 * 职责：轮询带待审标签的 Issue → 文本 + 抽审图片送 MiMo 多模态判定
 *       → 通过：自动把标签改成 approved（github-issues 老插件随后固化上线）
 *       → 不通过：保留待审，在 Issue 上贴 AI 判定理由，等人工复审
 *
 * 设计要点：
 * - 只「放行」不「拒绝」：AI 判定不通过时不自动关闭/删除，避免误判丢内容
 * - 多图抽查：首图必审 + 其余随机抽样（可配置张数），控制耗时与 token 成本
 * - 凭证继承 weibo-watch 的 MiMo 配置（llmBaseUrl/llmKey/llmModel），无需重复配置
 */
const fs = require('fs');
const path = require('path');
const core = require('../../lib/core');

/* ---------------- 审核历史（独立文件，不随面板保存被覆盖） ----------------
   config.plugins.data['ai-review'] 存的是配置；通用 PUT /api/plugins/:name/data 是整体替换，
   面板 collect() 不含 history → 每次保存都会把历史抹掉。故历史单独落盘。 */
const HISTORY_FILE = path.join(core.PATHS.DATA_DIR, 'ai-review-history.json');
const HISTORY_MAX = 200;

function readHistory() {
    try {
        const j = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        return Array.isArray(j) ? j : [];
    } catch (e) { return []; }
}

function writeHistory(list) {
    try {
        fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(list.slice(0, HISTORY_MAX), null, 2), 'utf-8');
    } catch (e) { /* 写失败不影响审核主流程 */ }
}

/** 合并新结果进历史：同 Issue 覆盖旧记录（重审不产生重复条目），最多保留 200 条 */
function mergeHistory(results) {
    const old = readHistory();
    const byNum = new Map();
    results.forEach(r => byNum.set(r.number, r));
    const merged = [];
    for (const r of results) merged.push(r);
    for (const h of old) {
        if (byNum.has(h.number)) continue; // 本轮已重审，保留新记录
        merged.push(h);
    }
    const trimmed = merged.slice(0, HISTORY_MAX);
    writeHistory(trimmed);
    return trimmed;
}

const DEFAULTS = {
    repo: 'xhrr/QMQ-SGLXQ',
    pendingLabels: 'content-pending,comment-pending', // 审核完成后移除的「待审」标记
    skipLabels: '',          // 明确跳过的标签（逗号分隔）；留空则只按「已审核」判定
    approvedLabel: 'approved',
    reviewedLabel: 'ai-reviewed',   // 队列判据：不带此标签的 open Issue 都会被审核
    rejectedLabel: 'ai-rejected',
    autoApprove: false,      // 默认建议模式：只判定不自动放行
    sampleCount: 3,          // 多图抽查张数（含首图）
    maxIssues: 10,           // 单轮最多处理条数
    pollInterval: 15,        // 轮询间隔（分钟）
    llmBaseUrl: '',
    llmKey: '',
    llmModel: ''
};

const PROMPT = `你是应援站的内容审核员。站点收录艺人写真、影视剧照、粉丝二创，属于正常的娱乐内容。请审核给定的投稿文本与图片。

【判定标准】
1. 文本：是否友善、是否含广告引流（联系方式、二维码、博彩/贷款/色情网站链接）、是否灌水无意义内容、是否含人身攻击或违法信息。
2. 图片：是否含色情低俗（裸露、性暗示、性行为）、暴力血腥、违禁品（毒品/赌博/管制刀具枪支）、政治敏感或其他违法违规内容。
3. 重要尺度把握：艺人的时尚写真、泳装/内衣风格的商业摄影、亲密合影、影视剧中的拥抱或吻戏画面、正常的身体线条展示，均属正常内容，不应判违规。只有明显越界的才判违规。

【输出格式】
只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块：
{
  "safe": true 或 false,
  "text_safe": true 或 false,
  "image_safe": true 或 false,
  "categories": ["命中的违规类别，安全则为空数组"],
  "reason": "一句话中文说明判定理由（20-60字）"
}`;

/* ---------------- 工具 ---------------- */

function cfg(ctx) {
    return { ...DEFAULTS, ...(ctx.getData() || {}) };
}

/** MiMo 配置：本插件优先，空则继承 weibo-watch（与 qq-channel-watch 同口径） */
function llmConfig(ctx) {
    const c = cfg(ctx);
    const config = core.readConfig();
    const w = (config.plugins && config.plugins.data && config.plugins.data['weibo-watch']) || {};
    return {
        baseUrl: String(c.llmBaseUrl || w.llmBaseUrl || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, ''),
        key: String(c.llmKey || w.llmKey || '').trim(),
        model: String(c.llmModel || w.llmModel || 'mimo-v2.5').trim()
    };
}

function tokenOf() {
    const config = core.readConfig();
    const data = (config.plugins && config.plugins.data) || {};
    return String((data['github-issues'] && data['github-issues'].token) || '').trim();
}

async function gh(url, token, options = {}) {
    const res = await fetch(`https://api.github.com${url}`, {
        method: options.method || 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'Actor-CMS',
            'Content-Type': 'application/json'
        },
        body: options.body
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
}

/** 分页拉取全部 open Issue（最多 5 页 / 500 条，防止极端情况拉爆） */
const FETCH_PER_PAGE = 100;
const FETCH_MAX_PAGES = 5;
async function fetchOpenIssues(repo, token) {
    const out = [];
    for (let page = 1; page <= FETCH_MAX_PAGES; page++) {
        const list = await gh(`/repos/${repo}/issues?state=open&per_page=${FETCH_PER_PAGE}&page=${page}`, token);
        if (!Array.isArray(list) || !list.length) break;
        out.push(...list);
        if (list.length < FETCH_PER_PAGE) break;
    }
    return out;
}

/** 从 Issue 正文提取图片外链（兼容 "- url" 与裸 URL 行，与 github-issues 解析口径一致） */
function extractImages(body) {
    const urls = [];
    for (const raw of String(body || '').split(/\r?\n/)) {
        const line = raw.trim();
        const m = line.match(/^[-*]\s*(https?:\/\/\S+)$/) || line.match(/^(https?:\/\/\S+\.(?:jpe?g|png|webp|gif))\S*$/i);
        if (m) urls.push(m[1]);
    }
    // 去重保序
    return [...new Set(urls)];
}

/** 抽查选图：首图必审 + 其余随机抽样，返回选中索引（升序） */
function sampleIndexes(total, sampleCount) {
    if (total <= 0) return [];
    const n = Math.max(1, Math.min(sampleCount || 1, total));
    if (n >= total) return Array.from({ length: total }, (_, i) => i);
    const rest = [];
    for (let i = 1; i < total; i++) rest.push(i);
    // Fisher-Yates 取前 n-1 个（不含首图）
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return [0, ...rest.slice(0, n - 1)].sort((a, b) => a - b);
}

/** 容错解析模型输出（可能带 markdown 围栏或前后杂文） */
function parseVerdict(text) {
    const raw = String(text || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('模型未返回 JSON');
    const obj = JSON.parse(raw.slice(start, end + 1));
    return {
        safe: obj.safe !== false,
        textSafe: obj.text_safe !== false,
        imageSafe: obj.image_safe !== false,
        categories: Array.isArray(obj.categories) ? obj.categories.slice(0, 6) : [],
        reason: String(obj.reason || '').slice(0, 200)
    };
}

/** 调 MiMo 多模态审核一条内容 */
async function reviewContent(ctx, { text, images }) {
    const { baseUrl, key, model } = llmConfig(ctx);
    if (!key) throw new Error('未配置 MiMo Key（可继承 weibo-watch 配置）');
    const picked = sampleIndexes(images.length, cfg(ctx).sampleCount);
    const content = [{ type: 'text', text: PROMPT + '\n\n【待审内容】\n' + text }];
    picked.forEach(i => content.push({ type: 'image_url', image_url: { url: images[i] } }));
    const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        // 推理型模型：reasoning tokens 也占 max_tokens，给足额度否则正文可能被截断
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 4000 }),
        signal: AbortSignal.timeout(180000)
    });
    if (!res.ok) throw new Error(`MiMo ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const choice = (json.choices && json.choices[0]) || {};
    const msg = choice.message || {};
    if (!msg.content) {
        throw new Error(`模型未返回正文（finish_reason=${choice.finish_reason || '?'}，可能 token 不足）`);
    }
    const verdict = parseVerdict(msg.content);
    return { verdict, sampled: picked, total: images.length, tokens: json.usage || null, finish: choice.finish_reason };
}

/* ---------------- 审核一轮 ---------------- */

async function runReview(ctx) {
    const c = cfg(ctx);
    const repo = String(c.repo || '').trim();
    const token = tokenOf();
    if (!repo || !token) return { ok: false, error: '未配置 repo 或 GitHub Token' };

    // 待审标记：审核完成后从 Issue 上移除（表示不再是待审状态）
    const pendingList = String(c.pendingLabels || '').split(',').map(s => s.trim()).filter(Boolean);
    // 跳过标签：命中的 Issue 一律不审核（安全阀，默认空 = 不跳过）
    const skipLc = String(c.skipLabels || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const reviewedLc = String(c.reviewedLabel || '').trim().toLowerCase();

    // 新口径：拉取全部 open Issue，凡是不带「已审核」(ai-reviewed) 标签的都纳入审核队列。
    // 旧口径按待审标签拉取——直接在 GitHub 新建的 Issue 没有任何标签，会被永远漏掉。
    // 幂等/防循环靠 reviewedLabel：每轮审完必打该标签；「退回待审」会把它清掉使其重回队列。
    let all;
    try {
        all = await fetchOpenIssues(repo, token);
    } catch (e) {
        return { ok: false, error: '拉取 open Issue 失败：' + e.message };
    }
    const queue = all.filter(i => {
        if (i.pull_request) return false;
        const names = (i.labels || []).map(l => String(l.name || '').toLowerCase());
        if (reviewedLc && names.includes(reviewedLc)) return false;  // 已审核过 → 跳过
        if (skipLc.some(s => names.includes(s))) return false;       // 命中跳过标签
        return true;
    });

    const results = [];
    for (const issue of queue.slice(0, c.maxIssues)) {
        const images = extractImages(issue.body);
        const record = {
            number: issue.number,
            title: issue.title,
            labels: issue.labels.map(l => l.name),
            images: images.length,
            imageUrls: images.slice(0, 6), // 供 Web 界面缩略图展示
            reviewedAt: new Date().toISOString()
        };
        try {
            // 异常自动重试：最多 2 次（首次 + 重试 1 次），仍失败则按「不通过」处理，交人工复核
            let lastErr = null;
            let outcome = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    outcome = await reviewContent(ctx, { text: issue.body || issue.title, images });
                    break;
                } catch (e) {
                    lastErr = e;
                    if (attempt === 0) {
                        ctx.log(`Issue #${issue.number} 审核异常，重试中: ${e.message}`);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                }
            }
            if (!outcome) {
                // 重试后仍异常 → 降级为「不通过」，打标记并贴原因，等人工复审
                record.error = lastErr ? lastErr.message : '审核异常';
                record.safe = false;
                record.reason = 'AI 审核连续异常，已按未通过处理，请人工复审';
                record.action = 'rejected';
                // 必须移除待审标签，否则下一轮轮询会把同一条再次拉进来重复审核
                const keep = record.labels.filter(l => !pendingList.includes(l) && l !== c.reviewedLabel && l !== c.rejectedLabel);
                try {
                    await gh(`/repos/${repo}/issues/${issue.number}`, token, {
                        method: 'PATCH',
                        body: JSON.stringify({ labels: [...keep, c.reviewedLabel, c.rejectedLabel].filter(Boolean) })
                    });
                    await gh(`/repos/${repo}/issues/${issue.number}/comments`, token, {
                        method: 'POST',
                        body: JSON.stringify({ body: `🤖 AI 审核异常（已重试 2 次）\n\n- 错误：${record.error}\n- 处理：按未通过标记，请人工复审；改标签为 \`${c.approvedLabel}\` 即放行。` })
                    });
                } catch (e2) { ctx.log(`Issue #${issue.number} 异常标记失败:`, e2.message); }
                results.push(record);
                continue;
            }
            const { verdict, sampled, tokens } = outcome;
            Object.assign(record, {
                safe: verdict.safe, textSafe: verdict.textSafe, imageSafe: verdict.imageSafe,
                categories: verdict.categories, reason: verdict.reason,
                sampled: sampled.map(i => i + 1), tokens: tokens && tokens.total_tokens
            });
            // 通过：可自动放行（autoApprove 开启时）→ 换成 approved，交给 github-issues 固化
            if (verdict.safe && c.autoApprove) {
                const keep = record.labels.filter(l => !pendingList.includes(l) && l !== c.rejectedLabel);
                await gh(`/repos/${repo}/issues/${issue.number}`, token, {
                    method: 'PATCH',
                    body: JSON.stringify({ labels: [...keep, c.approvedLabel, c.reviewedLabel].filter(Boolean) })
                });
                record.action = 'approved';
            } else {
                // 未开启自动放行 / 判定不通过：打审核标记 + 贴理由，等人处理
                // ⚠️ 同时移除待审标签——否则轮询会把已审过的再次拉入，形成重复审核死循环
                const keep = record.labels.filter(l => !pendingList.includes(l) && l !== c.reviewedLabel && l !== c.rejectedLabel);
                const extra = verdict.safe ? [c.reviewedLabel] : [c.reviewedLabel, c.rejectedLabel];
                await gh(`/repos/${repo}/issues/${issue.number}`, token, {
                    method: 'PATCH',
                    body: JSON.stringify({ labels: [...keep, ...extra].filter(Boolean) })
                });
                await gh(`/repos/${repo}/issues/${issue.number}/comments`, token, {
                    method: 'POST',
                    body: JSON.stringify({
                        body: `🤖 AI 审核${verdict.safe ? '建议通过' : '未通过'}\n\n- 结论：${verdict.safe ? '安全' : '疑似违规'}\n- 文本：${verdict.textSafe ? '安全' : '有问题'}\n- 图片：${verdict.imageSafe ? '安全' : '有问题'}\n- 类别：${verdict.categories.length ? verdict.categories.join('、') : '无'}\n- 理由：${verdict.reason}\n- 抽查图片：第 ${sampled.map(i => i + 1).join('、')} 张 / 共 ${images.length} 张\n\n人工复审：改标签为 \`${c.approvedLabel}\` 即放行。`
                    })
                });
                record.action = verdict.safe ? 'suggested-pass' : 'rejected';
            }
        } catch (e) {
            record.error = e.message;
            record.safe = false;
            record.reason = record.reason || '审核流程异常，请人工复审';
            record.action = record.action || 'rejected';
            ctx.log(`Issue #${issue.number} 审核失败:`, e.message);
        }
        results.push(record);
    }

    mergeHistory(results);
    ctx.setData({
        ...c,
        lastRun: new Date().toISOString(),
        lastStatus: `本轮审核 ${results.length} 条：通过 ${results.filter(r => r.safe).length}，未通过 ${results.filter(r => r.safe === false).length}，异常 ${results.filter(r => r.error).length}`
    });
    return { ok: true, results, status: ctx.getData().lastStatus };
}

/* ---------------- 插件入口 ---------------- */

module.exports = function (ctx) {
    ctx.app.post('/api/plugins/ai-review/run', async (req, res) => {
        try {
            res.json(await runReview(ctx));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 历史记录（Web 界面用）
    ctx.app.get('/api/plugins/ai-review/history', (req, res) => {
        const d = ctx.getData();
        res.json({ history: readHistory(), lastRun: d.lastRun || null, lastStatus: d.lastStatus || null });
    });

    // 人工复审：改标签（放行 / 拒绝 / 重置为待审）
    ctx.app.post('/api/plugins/ai-review/resolve', async (req, res) => {
        try {
            const c = cfg(ctx);
            const token = tokenOf();
            if (!token) return res.status(400).json({ error: '未配置 GitHub Token' });
            const number = parseInt(req.body && req.body.number, 10);
            const action = String((req.body && req.body.action) || '');
            if (!number || !['approve', 'reject', 'pending'].includes(action)) {
                return res.status(400).json({ error: '参数错误（number/action）' });
            }
            const issue = await gh(`/repos/${c.repo}/issues/${number}`, token);
            const names = issue.labels.map(l => l.name);
            const pending = String(c.pendingLabels || '').split(',').map(s => s.trim()).filter(Boolean);
            // 队列判据 = 不带 reviewedLabel；故：放行/拒绝都保留 reviewed（不再入队），
            // 「退回待审」必须清掉 reviewed 与 approved/rejected，否则不会被重新审核
            const stripReview = n => n !== c.reviewedLabel && n !== c.rejectedLabel;
            let next;
            if (action === 'approve') {
                next = [...names.filter(n => !pending.includes(n) && n !== c.rejectedLabel), c.approvedLabel, c.reviewedLabel];
            } else if (action === 'reject') {
                next = [...names.filter(n => !pending.includes(n) && n !== c.approvedLabel && n !== c.reviewedLabel), c.rejectedLabel, c.reviewedLabel];
            } else {
                next = [...names.filter(stripReview), pending[0]];
            }
            await gh(`/repos/${c.repo}/issues/${number}`, token, {
                method: 'PATCH',
                body: JSON.stringify({ labels: [...new Set(next.filter(Boolean))] })
            });
            await gh(`/repos/${c.repo}/issues/${number}/comments`, token, {
                method: 'POST',
                body: JSON.stringify({ body: `👤 人工复审：${action === 'approve' ? '放行（标签改为 approved）' : action === 'reject' ? '拒绝' : '退回待审'}` })
            });
            // 同步历史记录里的动作
            const history = readHistory().map(h => h.number === number ? { ...h, human: action, humanAt: new Date().toISOString() } : h);
            writeHistory(history);
            res.json({ success: true, action, number });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 定时轮询
    let lastPoll = Date.now();
    const tick = setInterval(() => {
        const iv = (parseInt(cfg(ctx).pollInterval, 10) || 15) * 60 * 1000;
        if (Date.now() - lastPoll >= iv) {
            lastPoll = Date.now();
            runReview(ctx).catch(e => ctx.log('轮询审核失败:', e.message));
        }
    }, 30 * 1000);
    tick.unref && tick.unref();

    ctx.onExport = null;
};

module.exports._internal = { extractImages, sampleIndexes, parseVerdict, PROMPT, readHistory, writeHistory, mergeHistory, HISTORY_MAX };
