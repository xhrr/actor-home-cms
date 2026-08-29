/**
 * Cloudflare R2 图片上传插件
 * 使用 S3 兼容 API 上传图片到 R2 存储桶，并返回外链。
 * 支持可选 WebP 压缩转换（sharp）。
 */
const { S3Client, PutObjectCommand, ListBucketsCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

module.exports = function (ctx) {
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024, files: 20 },
        fileFilter: (req, file, cb) => {
            const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            cb(null, allowed.includes(file.mimetype));
        }
    });

    function getClient(config) {
        if (!config.accountId || !config.accessKeyId || !config.secretAccessKey) {
            throw new Error('请先在插件配置中填写 Cloudflare R2 信息');
        }
        const endpoint = config.endpoint
            ? String(config.endpoint).replace(/\/+$/, '')
            : `https://${config.accountId}.r2.cloudflarestorage.com`;
        const region = config.region || 'auto';
        return new S3Client({
            region,
            endpoint,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            }
        });
    }

    function publicUrl(config, key) {
        let base = String(config.publicBaseUrl || '').trim().replace(/\/+$/, '');
        if (!base) throw new Error('未配置 Public Base URL，无法生成外链');
        // 没写协议头时自动补 https://，保证外链完整可访问
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(base)) base = 'https://' + base;
        return `${base}/${key}`;
    }

    /* ---------------- key 生成规则 ---------------- */

    const NAME_RE = /[^\w\u4e00-\u9fa5.\-]/g;

    // 去掉路径与扩展名，只留文件名主体，并清理非法字符
    function sanitizeBasename(name) {
        const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
        return base
            .replace(NAME_RE, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^[\-.]+|[\-.]+$/g, '')
            .slice(0, 64) || 'image';
    }

    // 按配置生成对象 key：prefix + [YYYY/MM/DD/] + 文件名(或随机名)
    // ext 为最终扩展名（可能因 WebP 转换变成 .webp）
    function buildKey(config, file, ext) {
        // 用户自定义前缀（可留空）；自动补/去掉首尾斜杠
        let prefix = config.keyPrefix == null ? 'images' : String(config.keyPrefix).trim();
        prefix = prefix.replace(/^\/+|\/+$/g, '');
        const prefixPart = prefix ? prefix + '/' : '';

        // 按日期分目录：YYYY/MM/DD/
        let datePart = '';
        if (config.dateSubfolder) {
            const d = new Date();
            const pad = n => String(n).padStart(2, '0');
            datePart = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}/`;
        }

        // 文件名：保留原名（清理后）或 时间戳+随机串
        const namePart = config.preserveFilename
            ? sanitizeBasename(file.originalname) + ext
            : Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;

        return prefixPart + datePart + namePart;
    }

    /* ---------------- WebP 压缩转换 ---------------- */

    // 返回 { buffer, contentType, ext }；不转换时原样返回
    async function toWebp(file, config) {
        const original = {
            buffer: file.buffer,
            contentType: file.mimetype,
            ext: path.extname(file.originalname).toLowerCase() || '.jpg'
        };
        // 开关未开，或 gif（保留动画），直接原样上传
        if (!config.webpConvert || file.mimetype === 'image/gif') return original;

        let pipeline = sharp(file.buffer);

        // 可选：限制最大宽度（0 = 不缩放）
        const maxWidth = parseInt(config.maxWidth, 10);
        if (maxWidth > 0) pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });

        // 质量 1-100，非法值回退 80
        const q = parseInt(config.webpQuality, 10);
        const quality = (q >= 1 && q <= 100) ? q : 80;

        const buffer = await pipeline.webp({ quality }).toBuffer();
        return { buffer, contentType: 'image/webp', ext: '.webp' };
    }

    // 自定义 key 在转换后把扩展名同步成 .webp（无扩展名则不动）
    function normalizeCustomKey(key, ext) {
        const current = path.extname(key).toLowerCase();
        if (ext === '.webp' && current && current !== '.webp') return key.slice(0, -current.length) + '.webp';
        return key;
    }

    // 测试连接
    ctx.app.post('/api/plugins/cloudflare-r2/test', (req, res) => {
        try {
            const client = getClient(ctx.getData());
            client.send(new ListBucketsCommand({})).then(data => {
                res.json({ success: true, buckets: (data.Buckets || []).map(b => b.Name) });
            }).catch(e => {
                res.status(500).json({ error: e.message });
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 上传图片（支持一次多张，字段名 images；兼容旧的单张 image）
    const uploadMid = upload.fields([
        { name: 'images', maxCount: 20 },
        { name: 'image', maxCount: 1 }
    ]);

    ctx.app.post('/api/plugins/cloudflare-r2/upload', (req, res) => {
        uploadMid(req, res, async err => {
            if (err) return res.status(400).json({ error: '上传失败: ' + err.message });
            try {
                const files = [].concat(
                    (req.files && req.files.images) || [],
                    (req.files && req.files.image) || []
                );
                if (!files.length) return res.status(400).json({ error: 'No file uploaded' });
                const config = ctx.getData();
                const client = getClient(config);

                const uploaded = [];
                const errors = [];

                // 兼容旧调用方：body.key 只在单张上传时作为完整 key 使用
                const customKey = req.body && typeof req.body.key === 'string'
                    ? String(req.body.key).trim()
                    : '';

                for (const file of files) {
                    try {
                        // 先转换（如需），再决定 key
                        const conv = await toWebp(file, config);
                        const key = customKey && files.length === 1
                            ? normalizeCustomKey(customKey, conv.ext)
                            : buildKey(config, file, conv.ext);

                        await client.send(new PutObjectCommand({
                            Bucket: config.bucket,
                            Key: key,
                            Body: conv.buffer,
                            ContentType: conv.contentType
                        }));
                        // 自动写入媒体库（远程条目，按 url 去重）
                        try {
                            ctx.media.addRemote({
                                url: publicUrl(config, key),
                                key,
                                filename: file.originalname,
                                source: 'r2'
                            });
                        } catch (mediaErr) {
                            ctx.log('save to media library failed:', mediaErr.message);
                        }
                        uploaded.push({
                            originalname: file.originalname,
                            url: publicUrl(config, key),
                            key,
                            converted: conv.contentType === 'image/webp' && file.mimetype !== 'image/webp',
                            format: conv.contentType
                        });
                    } catch (e) {
                        errors.push({ originalname: file.originalname, error: e.message });
                    }
                }

                res.json({ success: true, uploaded, errors });
            } catch (e) {
                ctx.log('upload failed:', e.message);
                res.status(500).json({ error: e.message });
            }
        });
    });
};
