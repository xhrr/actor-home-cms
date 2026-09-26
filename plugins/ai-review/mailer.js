/**
 * 零依赖 SMTP 邮件发送（内置 net/tls，风格对齐 server.js 内置 zlib 的零依赖思路）
 *
 * 能力：465 隐式 TLS；其他端口 EHLO + STARTTLS 升级（服务器支持时）；
 *       AUTH LOGIN（服务器不认时兜底 AUTH PLAIN）；未配置账号则匿名发送；
 *       UTF-8 主题/正文（base64 传输编码）；multipart/alternative（纯文本 + HTML）；
 *       多收件人；点填充（dot-stuffing）；全程超时保护。
 * 不做：附件、DKIM/签名——审核提醒场景不需要。
 */
'use strict';
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');

/** RFC 2047 B 编码（UTF-8 头部，如中文主题/显示名） */
function encHeader(s) {
    return '=?UTF-8?B?' + b64(s) + '?=';
}

/** base64 按每行 76 字符折行（传输编码要求） */
function wrapBase64(s) {
    return String(s).replace(/(.{76})/g, '$1\r\n');
}

function rfc2822(d) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = n => String(n).padStart(2, '0');
    return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${mons[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
        `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** 组装 MIME 报文（不含点填充；CRLF 行尾）。导出供测试 */
function buildMessage({ from, to, subject, text, html, fromName }) {
    const boundary = '----actor-cms-' + crypto.randomBytes(8).toString('hex');
    const headers = [
        'From: ' + (fromName ? encHeader(fromName) + ' <' + from + '>' : from),
        'To: ' + (Array.isArray(to) ? to.join(', ') : to),
        'Subject: ' + encHeader(subject),
        'Date: ' + rfc2822(new Date()),
        'Message-ID: <' + Date.now() + '.' + crypto.randomBytes(6).toString('hex') + '@actor-home-cms>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' + boundary + '"'
    ];
    const part = (ct, body) =>
        '--' + boundary + '\r\n' +
        'Content-Type: ' + ct + '; charset=utf-8\r\n' +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        wrapBase64(b64(body));
    const body = [
        part('text/plain', String(text || '')),
        part('text/html', String(html || '')),
        '--' + boundary + '--'
    ].join('\r\n');
    return headers.join('\r\n') + '\r\n\r\n' + body;
}

/** 点填充：DATA 内容中行首的 . 要双写（RFC 5321） */
function dotStuff(message) {
    return String(message).replace(/^\./gm, '..');
}

/**
 * 带应答读取的连接封装。STARTTLS 升级后用 attach() 换到新 socket 上继续读。
 * readReply() 解析多行应答（如 250-...），返回 { code, lines }。
 */
function createConn(socket) {
    const state = { socket: null, buf: '', waiters: [], error: null };
    function onData(chunk) {
        state.buf += chunk.toString('utf8');
        pump();
    }
    function onError(e) {
        state.error = e;
        flushWaiters(new Error('SMTP 连接错误: ' + e.message));
    }
    function onClose() {
        flushWaiters(new Error('SMTP 连接已关闭'));
    }
    function flushWaiters(err) {
        const ws = state.waiters.splice(0);
        ws.forEach(w => w.reject(err || new Error('SMTP 连接已关闭')));
    }
    /** 完整应答的结束位置（多行应答以「数字+空格」或「数字行尾」的行终止）；-1 = 未完整 */
    function completeReplyEnd(buf) {
        let pos = 0;
        for (;;) {
            const idx = buf.indexOf('\r\n', pos);
            if (idx < 0) return -1;
            if (/^\d{3}($| )/.test(buf.slice(pos, idx))) return idx + 2;
            pos = idx + 2;
        }
    }
    function pump() {
        for (;;) {
            const end = completeReplyEnd(state.buf);
            if (end < 0) break; // 应答未收完整（多行中间行不含终止行）
            const consumed = state.buf.slice(0, end);
            state.buf = state.buf.slice(end);
            const w = state.waiters.shift();
            if (!w) continue; // 无人等待的应答（如 QUIT 的 221）直接丢弃
            const lines = consumed.split('\r\n').filter(l => l.length);
            w.resolve({ code: parseInt(lines[lines.length - 1].slice(0, 3), 10), lines });
        }
    }
    const ret = {
        attach(newSocket) {
            if (state.socket) {
                state.socket.removeListener('data', onData);
                state.socket.removeListener('error', onError);
                state.socket.removeListener('close', onClose);
            }
            state.socket = newSocket;
            state.buf = '';
            newSocket.on('data', onData);
            newSocket.on('error', onError);
            newSocket.on('close', onClose);
        },
        readReply(timeoutMs) {
            return new Promise((resolve, reject) => {
                const t = setTimeout(() => {
                    const i = state.waiters.indexOf(w);
                    if (i >= 0) { state.waiters.splice(i, 1); w.reject(new Error('SMTP 应答超时')); }
                }, timeoutMs);
                const w = {
                    resolve: v => { clearTimeout(t); resolve(v); },
                    reject: e => { clearTimeout(t); reject(e); }
                };
                state.waiters.push(w);
                pump(); // 数据可能已先到
            });
        },
        send(cmd) {
            return new Promise((resolve, reject) => {
                state.socket.write(cmd + '\r\n', 'utf8', e => e ? reject(new Error('SMTP 发送失败: ' + e.message)) : resolve());
            });
        },
        async command(cmd, expect, label) {
            await this.send(cmd);
            const reply = await this.readReply(timeoutOf(this));
            if (!Array.isArray(expect) ? reply.code !== expect : !expect.includes(reply.code)) {
                throw new Error(`SMTP ${label || cmd.split(' ')[0]} 失败（${reply.code}）: ${reply.lines.join(' / ').slice(0, 200)}`);
            }
            return reply;
        }
    };
    const conn = ret;
    conn.attach(socket); // 初始 socket 也要挂上监听（STARTTLS 升级时会换 socket 再次 attach）
    return ret;
}

// command() 里要拿超时值：挂在 conn 对象上传递
function timeoutOf(conn) { return conn._timeoutMs || 30000; }

function ehloCaps(reply) {
    // 多行应答第一行是问候，能力在其余行（如 "250-AUTH LOGIN PLAIN"）
    return reply.lines.slice(1).join(' ').toUpperCase();
}

/**
 * 发送邮件。
 * opts: { host, port, user, pass, from, fromName, to:[], subject, text, html, timeoutMs, tlsReject }
 */
async function sendMail(opts) {
    const {
        host, port = 465, user = '', pass = '',
        from, fromName = '', to = [],
        subject, text = '', html = '',
        timeoutMs = 30000, tlsReject = true,
        implicitTls: implicitTls_  // 可选覆盖：true = 连接即 TLS；缺省按端口判定（465 = 隐式 TLS）
    } = opts || {};
    const rcpts = (Array.isArray(to) ? to : [to]).map(s => String(s).trim()).filter(Boolean);
    if (!host || !from || !rcpts.length) throw new Error('SMTP 参数缺失（host / from / to）');
    if (!subject) throw new Error('缺少邮件主题');

    const implicitTls = implicitTls_ !== undefined ? !!implicitTls_ : parseInt(port, 10) === 465;
    // SNI 不能是 IP 地址（Node 会抛 ERR_INVALID_ARG_VALUE）：域名才带 servername
    const tlsOpts = net.isIP(host) ? {} : { servername: host };
    const socket = implicitTls
        ? tls.connect({ host, port: parseInt(port, 10) || 465, rejectUnauthorized: tlsReject !== false, ...tlsOpts })
        : net.connect({ host, port: parseInt(port, 10) || 25 });
    socket.setTimeout(timeoutMs);
    await new Promise((resolve, reject) => {
        const ev = implicitTls ? 'secureConnect' : 'connect';
        const ok = () => { cleanup(); resolve(); };
        const err = e => { cleanup(); socket.destroy(); reject(new Error('SMTP 连接失败: ' + e.message)); };
        const tof = () => { cleanup(); socket.destroy(); reject(new Error('SMTP 连接超时（' + timeoutMs + 'ms）')); };
        function cleanup() {
            socket.removeListener(ev, ok);
            socket.removeListener('error', err);
            socket.removeListener('timeout', tof);
        }
        socket.once(ev, ok);
        socket.once('error', err);
        socket.once('timeout', tof);
    });

    const conn = createConn(socket);
    conn._timeoutMs = timeoutMs;
    try {
        let reply = await conn.readReply(timeoutMs);
        if (reply.code !== 220) throw new Error(`SMTP 握手失败（${reply.code}）: ${reply.lines.join(' / ').slice(0, 200)}`);

        const ehlo = async () => {
            const r = await conn.command('EHLO actor-home-cms', 250, 'EHLO');
            return ehloCaps(r);
        };
        let caps = await ehlo();

        // 非 465 端口：服务器支持 STARTTLS 就升级（明文口令不该裸奔）
        if (!implicitTls && caps.includes('STARTTLS')) {
            await conn.command('STARTTLS', 220, 'STARTTLS');
            const tlsSock = tls.connect({ socket, rejectUnauthorized: tlsReject !== false, ...tlsOpts });
            await new Promise((resolve, reject) => {
                tlsSock.once('secureConnect', resolve);
                tlsSock.once('error', e => reject(new Error('TLS 升级失败: ' + e.message)));
            });
            socket.setTimeout(timeoutMs);
            conn.attach(tlsSock);
            caps = await ehlo();
        }

        if (user && pass) {
            await conn.send('AUTH LOGIN');
            reply = await conn.readReply(timeoutMs);
            if (reply.code === 334) {
                await conn.send(b64(user));
                reply = await conn.readReply(timeoutMs);
                if (reply.code !== 334) throw new Error(`SMTP 认证失败（用户名被拒 ${reply.code}）: ${reply.lines.join(' / ').slice(0, 200)}`);
                await conn.send(b64(pass));
                reply = await conn.readReply(timeoutMs);
                if (reply.code !== 235) throw new Error(`SMTP 认证失败（${reply.code}，检查账号与授权码）: ${reply.lines.join(' / ').slice(0, 200)}`);
            } else if (reply.code === 500 || reply.code === 502 || reply.code === 504) {
                // LOGIN 不可用，兜底 PLAIN
                await conn.command('AUTH PLAIN ' + b64('\0' + user + '\0' + pass), 235, 'AUTH PLAIN');
            } else {
                throw new Error(`SMTP 认证被拒（${reply.code}）: ${reply.lines.join(' / ').slice(0, 200)}`);
            }
        }

        await conn.command(`MAIL FROM:<${from}>`, 250, 'MAIL FROM');
        for (const rcpt of rcpts) {
            await conn.command(`RCPT TO:<${rcpt}>`, [250, 251], 'RCPT TO');
        }
        await conn.command('DATA', 354, 'DATA');
        await conn.send(dotStuff(buildMessage({ from, to: rcpts, subject, text, html, fromName })));
        await conn.send('.');
        reply = await conn.readReply(timeoutMs);
        if (reply.code !== 250) throw new Error(`SMTP 投递失败（${reply.code}）: ${reply.lines.join(' / ').slice(0, 200)}`);

        // QUIT 尽力而为：失败/超时不影响投递结果
        try {
            await conn.send('QUIT');
            await conn.readReply(3000);
        } catch (_) { /* ignore */ }
        return { ok: true };
    } finally {
        try { socket.destroy(); } catch (_) { /* ignore */ }
    }
}

module.exports = { sendMail, buildMessage, dotStuff, wrapBase64, encHeader, rfc2822 };
