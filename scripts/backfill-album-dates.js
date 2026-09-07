/**
 * 图集发帖时间回填脚本（一次性工具）
 *
 * 原理：小红书/抖音的帖子 ID 都是雪花 ID，高 32 位编码了发帖时间戳——
 *   - 小红书 explore/{24位hex}：前 8 位 hex = unix 秒（直接从 URL 解码，零网络请求）
 *   - 抖音 v.douyin.com 短链：跟随一次 302 拿真实地址 /share/video|note/{19位数字}/，
 *     BigInt(id) >> 32n = unix 秒
 * 日期一律按北京时间（UTC+8）取年月日（发帖受众在国内）。
 *
 * 用法：
 *   node scripts/backfill-album-dates.js --config <config.json>            # dry-run，只出报告
 *   node scripts/backfill-album-dates.js --config <config.json> --apply    # 回填（自动备份原文件）
 *   可选：--report <路径>（默认与 config 同目录 album-dates-report.json）、--delay <毫秒>（默认 1500）
 *
 * 安全性：默认 dry-run 不写任何文件；--apply 时先备份 config 为 <原名>.bak-<时间戳>，
 *        且只给 date 为空的图集补时间，已有日期的一律不覆盖。
 */
const fs = require('fs');
const path = require('path');

const BJ_OFFSET_MS = 8 * 3600 * 1000;

/** 北京时间年月日；无效/越界返回 null */
function msToBJDate(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const d = new Date(ms + BJ_OFFSET_MS);
    const y = d.getUTCFullYear();
    if (y < 2020 || y > 2100) return null; // 雪花解码出离谱年份 = ID 形态不符，宁缺毋滥
    return d.toISOString().slice(0, 10);
}

/** 小红书：explore/{24hex} 或 discovery/item/{24hex} → 高32位hex 即 unix 秒 */
function decodeXhs(url) {
    const m = String(url || '').match(/xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]{24})/i);
    if (!m) return null;
    const ms = parseInt(m[1].slice(0, 8), 16) * 1000;
    const date = msToBJDate(ms);
    return date ? { date, method: 'xhs-id-decode', raw: '0x' + m[1].slice(0, 8) } : null;
}

/** 抖音：真实地址 /share/video|note/{15-25位数字} → 高32位 = unix 秒 */
function decodeDouyinId(url) {
    const m = String(url || '').match(/(?:share\/(?:video|note)|video|note)\/(\d{15,25})/);
    if (!m) return null;
    const ms = Number(BigInt(m[1]) >> 32n) * 1000;
    const date = msToBJDate(ms);
    return date ? { date, method: 'douyin-id-decode', raw: m[1] } : null;
}

/** 抖音短链 → 跟随重定向拿真实地址（不爬页面内容） */
async function resolveDouyinShort(shortUrl, timeoutMs = 15000) {
    const res = await fetch(shortUrl, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' } });
    return res.url || '';
}

/** 单条图集 → 时间结果（不动网络的部分供单测） */
async function resolveAlbum(album, { delay = 1500 } = {}) {
    const url = String(album.sourceUrl || '');
    if (!url) return { error: '无原始链接' };
    // xhslink.cn 短链归属小红书（注意判断在域名匹配之前：短链本身不含 xiaohongshu.com）
    if (/xiaohongshu\.com|xhslink\.cn/i.test(url)) {
        // xhslink.cn 等短链先解析
        let target = url;
        if (/xhslink\.cn/i.test(url)) {
            target = await resolveDouyinShort(url);
            await new Promise(r => setTimeout(r, delay));
        }
        return decodeXhs(target) || decodeXhs(url) || { error: '小红书 ID 解码失败（' + target.slice(0, 60) + '）' };
    }
    if (/douyin\.com/i.test(url)) {
        let target = url;
        if (/v\.douyin\.com/i.test(url)) {
            target = await resolveDouyinShort(url);
            await new Promise(r => setTimeout(r, delay));
        }
        return decodeDouyinId(target) || { error: '抖音 ID 解码失败（' + target.slice(0, 60) + '）' };
    }
    return { error: '未知平台' };
}

async function main() {
    const args = process.argv.slice(2);
    const opt = (name, def) => {
        const i = args.indexOf('--' + name);
        return i >= 0 && args[i + 1] ? args[i + 1] : def;
    };
    const apply = args.includes('--apply');
    const configPath = path.resolve(opt('config', ''));
    const reportPath = path.resolve(opt('report', path.join(path.dirname(configPath), 'album-dates-report.json')));
    const delay = parseInt(opt('delay', '1500'), 10) || 1500;
    if (!fs.existsSync(configPath)) {
        console.error('config 不存在:', configPath);
        process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const albums = (config.gallery && config.gallery.albums) || [];

    const resolved = [], failed = [], skipped = [];
    for (let i = 0; i < albums.length; i++) {
        const a = albums[i];
        const label = (a.title || '未命名 ' + i).slice(0, 24);
        if (a.date) { skipped.push({ index: i, title: label, date: a.date, reason: '已有日期，跳过' }); continue; }
        process.stdout.write(`[${i + 1}/${albums.length}] ${label} … `);
        let result;
        try { result = await resolveAlbum(a, { delay }); }
        catch (e) { result = { error: e.message }; }
        if (result && result.date) {
            resolved.push({ index: i, id: a.id || '', title: label, platform: /xiaohongshu/i.test(a.sourceUrl) ? 'xhs' : 'douyin', sourceUrl: a.sourceUrl, date: result.date, method: result.method, raw: result.raw });
            console.log(result.date + '（' + result.method + '）');
        } else {
            failed.push({ index: i, id: a.id || '', title: label, sourceUrl: a.sourceUrl, reason: (result && result.error) || '未知失败' });
            console.log('❌ ' + ((result && result.error) || '失败'));
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        configPath,
        mode: apply ? 'APPLY' : 'DRY-RUN',
        total: albums.length,
        resolvedCount: resolved.length,
        failedCount: failed.length,
        skippedCount: skipped.length,
        resolved, failed, skipped
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 4));
    console.log(`\n报告: ${reportPath}`);
    console.log(`结果: 成功 ${resolved.length} / 失败 ${failed.length} / 已有日期跳过 ${skipped.length}`);

    if (apply) {
        if (!resolved.length) { console.log('无可回填项，未写文件'); return; }
        const backup = configPath + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(configPath, backup);
        resolved.forEach(r => { albums[r.index].date = r.date; });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        console.log(`已回填 ${resolved.length} 条 → ${configPath}（备份: ${backup}）`);
    } else {
        console.log('dry-run 模式：未写 config。确认报告后加 --apply 执行回填。');
    }
}

module.exports = { msToBJDate, decodeXhs, decodeDouyinId, resolveAlbum };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
