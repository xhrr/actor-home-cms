/**
 * 投稿页（/contribute.html）
 * 独立页面：不依赖 page.js / gallery.js / comments.js，仅用 cms.js 的导航壳。
 * 提交端：同源 /api/contribute（公共站由 contribute-gateway 插件生成的 Pages Function 提供）。
 * 图片：客户端 canvas 压缩（长边 ≤2000px，优先 webp，老浏览器退化 jpg）→ Function 传 R2 → 组装待审 Issue。
 */
(function () {
    'use strict';

    const ENDPOINT = '/api/contribute';
    const MAX_IMAGES = 30;
    const MAX_EDGE = 2000;
    const WEBP_QUALITY = 0.82;
    const JPEG_QUALITY = 0.85;

    let currentType = 'album';
    let pendingFiles = []; // { blob, ext, name }

    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    /* ---------- 类型切换 ---------- */

    function setType(type) {
        currentType = type;
        document.querySelector('[data-type="album"]').classList.toggle('active', type === 'album');
        document.querySelector('[data-type="works"]').classList.toggle('active', type === 'works');
        $('fieldsAlbum').style.display = type === 'album' ? '' : 'none';
        $('fieldsWorks').style.display = type === 'works' ? '' : 'none';
        $('imgLabel').textContent = type === 'album'
            ? '图片 *（最多 30 张，自动压缩为 webp）'
            : '剧照 *（最多 30 张，第一张作为海报，自动压缩为 webp）';
        renderThumbs(); // 角标文案随类型切换（封面 ↔ 海报）
    }

    /* ---------- 图片压缩与预览 ---------- */

    // canvas 长边缩放 + webp 编码；老浏览器退化 jpg（Function 按实际格式入库）
    async function compressImage(file) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch (e) {
            throw new Error('无法读取图片：' + file.name);
        }
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
        if (window.close && bitmap.close) bitmap.close();
        for (const [type, quality, ext] of [['image/webp', WEBP_QUALITY, 'webp'], ['image/jpeg', JPEG_QUALITY, 'jpg']]) {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
            if (blob && blob.type === type) return { blob, ext, name: file.name };
        }
        throw new Error('图片编码失败：' + file.name);
    }

    const coverTag = () => (currentType === 'works' ? '海报' : '封面');

    function renderThumbs() {
        const box = $('contribThumbs');
        box.innerHTML = pendingFiles.map((it, i) => `
            <div class="contrib-thumb">
                <img src="${URL.createObjectURL(it.blob)}" alt="${esc(it.name)}">
                ${i === 0 ? `<span class="contrib-thumb__tag">${coverTag()}</span>` : ''}
                <button type="button" class="contrib-thumb__del" data-del="${i}" aria-label="移除">×</button>
            </div>
        `).join('');
    }

    /** 点击缩略图设为封面/海报：把该图移到首位（保持「第一张=封面」不变量，增删图不错位） */
    function setCover(index) {
        if (!Number.isInteger(index) || index <= 0 || index >= pendingFiles.length) return;
        pendingFiles.unshift(pendingFiles.splice(index, 1)[0]);
        renderThumbs();
    }

    async function addFiles(fileList) {
        const files = [...fileList].filter(f => /^image\//.test(f.type));
        for (const f of files) {
            if (pendingFiles.length >= MAX_IMAGES) {
                showMsg(`最多 ${MAX_IMAGES} 张`, true);
                break;
            }
            try {
                pendingFiles.push(await compressImage(f));
            } catch (e) {
                showMsg(e.message, true);
            }
        }
        renderThumbs();
    }

    /* ---------- 拖拽上传（文件 + 文件夹递归） ---------- */

    // 目录 entry 的 readEntries 每批最多 100 条，须循环读到空为止
    function collectFilesFromEntry(entry, out) {
        return new Promise(resolve => {
            if (!entry) return resolve();
            if (entry.isFile) {
                entry.file(f => { out.push(f); resolve(); }, () => resolve());
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                const batch = [];
                const readBatch = () => reader.readEntries(async entries => {
                    if (!entries.length) {
                        for (const e of batch) await collectFilesFromEntry(e, out);
                        resolve();
                    } else {
                        batch.push(...entries);
                        readBatch();
                    }
                }, () => resolve());
                readBatch();
            } else resolve();
        });
    }

    /** webkitGetAsEntry 必须在事件同步阶段全部取出（items 在 yield 后失效），返回处理 Promise */
    function handleDrop(dataTransfer) {
        const entries = [];
        for (const item of dataTransfer.items || []) {
            if (item.kind === 'file' && item.webkitGetAsEntry) {
                const entry = item.webkitGetAsEntry();
                if (entry) entries.push(entry);
            }
        }
        if (!entries.length) {
            // 无 entries 支持（极端老浏览器）：退化为普通文件列表
            return addFiles(dataTransfer.files || []);
        }
        const files = [];
        return entries.reduce((p, entry) => p.then(() => collectFilesFromEntry(entry, files)), Promise.resolve())
            .then(() => addFiles(files));
    }

    /* ---------- 提交 ---------- */

    function setBusy(busy, percent) {
        const btn = $('contribSubmit');
        btn.disabled = busy;
        btn.textContent = busy ? `上传中 ${percent || 0}%` : '提 交 投 稿';
        $('contribBar').style.display = busy ? 'block' : 'none';
        if (busy) $('contribBarFill').style.width = (percent || 0) + '%';
    }

    function showMsg(text, isError) {
        const el = $('contribMsg');
        el.textContent = text;
        el.className = 'contrib-msg ' + (isError ? 'is-err' : 'is-ok');
    }

    function buildFormData() {
        const fd = new FormData();
        fd.append('type', currentType);
        const val = id => $(id).value.trim();
        fd.append('title', val('f-title'));
        fd.append('sourceUrl', val('f-sourceUrl'));
        if (currentType === 'album') {
            fd.append('date', val('f-date'));
            fd.append('author', val('f-author'));
        } else {
            fd.append('category', val('f-category'));
            fd.append('year', val('f-year'));
            fd.append('director', val('f-director'));
            fd.append('role', val('f-role'));
            fd.append('synopsis', val('f-synopsis'));
        }
        pendingFiles.forEach(it => fd.append('images', it.blob, `upload.${it.ext}`));
        return fd;
    }

    function sendForm(fd) {
        return new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', ENDPOINT);
            xhr.responseType = 'json';
            xhr.timeout = 120000; // 挂死的请求不再永久转圈，按超时失败处理
            xhr.upload.onprogress = e => {
                if (e.lengthComputable) setBusy(true, Math.round(e.loaded / e.total * 100));
            };
            xhr.onload = () => resolve({ status: xhr.status, body: xhr.response || {} });
            xhr.onerror = () => resolve({ status: 0, body: {} });
            xhr.ontimeout = () => resolve({ status: 0, body: {} });
            xhr.send(fd);
        });
    }

    async function submitForm() {
        const title = $('f-title').value.trim();
        if (!title) { showMsg('请填写标题', true); return; }
        if (currentType === 'album' && !$('f-date').value) { showMsg('请选择发帖日期', true); return; }
        if (currentType === 'album' && !$('f-author').value.trim()) { showMsg('请填写作者 / 摄影师', true); return; }
        const sourceUrl = $('f-sourceUrl').value.trim();
        if (!/^https?:\/\//i.test(sourceUrl)) { showMsg('请填写原始链接（http/https 开头）', true); return; }
        if (currentType === 'works') {
            if (!$('f-category').value) { showMsg('请选择分类', true); return; }
            if (!$('f-year').value.trim()) { showMsg('请填写年份', true); return; }
            if (!$('f-role').value.trim()) { showMsg('请填写饰演角色', true); return; }
            if (!$('f-synopsis').value.trim()) { showMsg('请填写简介', true); return; }
        }
        if (!pendingFiles.length) { showMsg('请至少选择一张图片', true); return; }

        setBusy(true, 0);
        const last = await sendForm(buildFormData());
        setBusy(false);

        if (last.status >= 200 && last.status < 300 && last.body.success) {
            showMsg(`✅ ${last.body.message || '投稿已提交，审核通过后上线'}（Issue #${last.body.issueNumber}）`, false);
            pendingFiles = [];
            renderThumbs();
            $('contribForm').reset();
            return;
        }
        // 失败原因分级提示：服务端给的文案优先，其次按状态归类
        const reason = last.body.error
            || (last.status === 0 ? '网络错误或超时，请检查网络后重试' : `投稿服务暂时不可用（${last.status}），请稍后再试`);
        showMsg('❌ 上传失败：' + reason, true);
    }

    /* ---------- 初始化 ---------- */

    function init() {
        if (window.CMS && typeof window.CMS.initNavShell === 'function') window.CMS.initNavShell();

        $('contribType').addEventListener('click', e => {
            const btn = e.target.closest('[data-type]');
            if (btn) setType(btn.dataset.type);
        });

        $('contribPick').addEventListener('click', () => $('contribFiles').click());

        // 拖拽上传：投放区 = 选择框；全页阻止浏览器默认打开行为
        const pick = $('contribPick');
        ['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
        pick.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            pick.classList.add('is-drag');
        });
        pick.addEventListener('dragleave', () => pick.classList.remove('is-drag'));
        pick.addEventListener('drop', e => {
            e.preventDefault();
            pick.classList.remove('is-drag');
            handleDrop(e.dataTransfer);
        });
        $('contribFiles').addEventListener('change', e => {
            addFiles(e.target.files);
            e.target.value = '';
        });
        $('contribThumbs').addEventListener('click', e => {
            if (e.target.closest('[data-del]')) return; // 删除按钮有自己的监听
            const thumb = e.target.closest('.contrib-thumb');
            if (!thumb) return;
            setCover([...$('contribThumbs').children].indexOf(thumb));
        });
        $('contribThumbs').addEventListener('click', e => {
            const del = e.target.closest('[data-del]');
            if (!del) return;
            pendingFiles.splice(parseInt(del.dataset.del, 10), 1);
            renderThumbs();
        });

        $('contribForm').addEventListener('submit', e => {
            e.preventDefault();
            if (!$('contribSubmit').disabled) submitForm();
        });
    }

    // 测试钩子（不影响运行时行为）
    window.ContributePage = {
        setType, buildFormData, compressImage, addFiles, setCover,
        getState: () => ({ type: currentType, count: pendingFiles.length, first: pendingFiles[0] && pendingFiles[0].name })
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
