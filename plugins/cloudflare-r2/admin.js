(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('cloudflare-r2', {
        label: 'Cloudflare R2 图片上传',
        render: function (data) {
            data = data || {};
            return `
                <div class="form-group">
                    <label>Account ID</label>
                    <input type="text" id="r2-account" value="${window.AdminCMS.esc(data.accountId || '')}" placeholder="Cloudflare Account ID">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Access Key ID</label>
                        <input type="text" id="r2-access-key" value="${window.AdminCMS.esc(data.accessKeyId || '')}" placeholder="R2 Access Key ID">
                    </div>
                    <div class="form-group">
                        <label>Secret Access Key</label>
                        <div class="token-field">
                            <input type="password" id="r2-secret-key" value="${window.AdminCMS.esc(data.secretAccessKey || '')}" placeholder="R2 Secret Access Key">
                            <button type="button" class="btn btn--sm" id="r2-secret-toggle">显示</button>
                        </div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Bucket</label>
                        <input type="text" id="r2-bucket" value="${window.AdminCMS.esc(data.bucket || '')}" placeholder="bucket-name">
                    </div>
                    <div class="form-group">
                        <label>Public Base URL</label>
                        <input type="text" id="r2-public-url" value="${window.AdminCMS.esc(data.publicBaseUrl || '')}" placeholder="https://pub-xxx.r2.dev 或 https://s3.amazonaws.com">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Endpoint（可选）</label>
                        <input type="text" id="r2-endpoint" value="${window.AdminCMS.esc(data.endpoint || '')}" placeholder="https://s3.amazonaws.com 或留空用 R2">
                    </div>
                    <div class="form-group">
                        <label>Region（可选）</label>
                        <input type="text" id="r2-region" value="${window.AdminCMS.esc(data.region || '')}" placeholder="us-east-1 / auto">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Key 前缀（可选）</label>
                        <input type="text" id="r2-key-prefix" value="${window.AdminCMS.esc(data.keyPrefix != null ? data.keyPrefix : 'images')}" placeholder="images（留空则为桶根目录）">
                    </div>
                    <div class="form-group">
                        <label class="toggle-label">
                            <input type="checkbox" id="r2-date-folder" ${data.dateSubfolder ? 'checked' : ''}>
                            按日期分目录（YYYY/MM/DD）
                        </label>
                        <label class="toggle-label" style="margin-top:0.6rem">
                            <input type="checkbox" id="r2-preserve-name" ${data.preserveFilename ? 'checked' : ''}>
                            保留原文件名（否则随机命名）
                        </label>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="toggle-label">
                            <input type="checkbox" id="r2-webp" ${data.webpConvert ? 'checked' : ''}>
                            上传时转 WebP 压缩
                        </label>
                        <p class="form-help">jpeg/png/webp 自动转 WebP；gif 保留原样（避免动图丢失动画）</p>
                    </div>
                    <div class="form-group">
                        <label>质量（1-100）</label>
                        <input type="number" id="r2-webp-quality" min="1" max="100" value="${window.AdminCMS.esc(data.webpQuality || 80)}">
                        <label style="margin-top:0.6rem">最大宽度 px（0=不缩放）</label>
                        <input type="number" id="r2-max-width" min="0" value="${window.AdminCMS.esc(data.maxWidth || 0)}">
                    </div>
                </div>
                <div class="form-group">
                    <button class="btn btn--primary btn--sm" id="r2-test">测试连接</button>
                    <span id="r2-test-result" style="margin-left:0.75rem;font-size:0.85rem"></span>
                </div>
                <div class="form-group">
                    <label>上传测试（可多选）</label>
                    <div class="token-field">
                        <input type="file" id="r2-upload-file" accept="image/*" multiple>
                        <button class="btn btn--ghost btn--sm" id="r2-upload-btn">上传到 R2</button>
                    </div>
                    <p class="form-help" id="r2-upload-result"></p>
                </div>
            `;
        },
        collect: function () {
            return {
                accountId: document.getElementById('r2-account') ? document.getElementById('r2-account').value : '',
                accessKeyId: document.getElementById('r2-access-key') ? document.getElementById('r2-access-key').value : '',
                secretAccessKey: document.getElementById('r2-secret-key') ? document.getElementById('r2-secret-key').value : '',
                bucket: document.getElementById('r2-bucket') ? document.getElementById('r2-bucket').value : '',
                publicBaseUrl: document.getElementById('r2-public-url') ? document.getElementById('r2-public-url').value : '',
                endpoint: document.getElementById('r2-endpoint') ? document.getElementById('r2-endpoint').value : '',
                region: document.getElementById('r2-region') ? document.getElementById('r2-region').value : '',
                keyPrefix: document.getElementById('r2-key-prefix') ? document.getElementById('r2-key-prefix').value : '',
                dateSubfolder: !!(document.getElementById('r2-date-folder') && document.getElementById('r2-date-folder').checked),
                preserveFilename: !!(document.getElementById('r2-preserve-name') && document.getElementById('r2-preserve-name').checked),
                webpConvert: !!(document.getElementById('r2-webp') && document.getElementById('r2-webp').checked),
                webpQuality: parseInt(document.getElementById('r2-webp-quality') && document.getElementById('r2-webp-quality').value, 10) || 80,
                maxWidth: parseInt(document.getElementById('r2-max-width') && document.getElementById('r2-max-width').value, 10) || 0
            };
        },
        bind: function () {
            const secretToggle = document.getElementById('r2-secret-toggle');
            const secretInput = document.getElementById('r2-secret-key');
            if (secretToggle && secretInput) {
                secretToggle.addEventListener('click', () => {
                    const show = secretInput.type === 'password';
                    secretInput.type = show ? 'text' : 'password';
                    secretToggle.textContent = show ? '隐藏' : '显示';
                });
            }

            const saveData = () => {
                const data = {
                    accountId: document.getElementById('r2-account').value,
                    accessKeyId: document.getElementById('r2-access-key').value,
                    secretAccessKey: document.getElementById('r2-secret-key').value,
                    bucket: document.getElementById('r2-bucket').value,
                    publicBaseUrl: document.getElementById('r2-public-url').value,
                    endpoint: document.getElementById('r2-endpoint').value,
                    region: document.getElementById('r2-region').value,
                    keyPrefix: document.getElementById('r2-key-prefix').value,
                    dateSubfolder: !!document.getElementById('r2-date-folder').checked,
                    preserveFilename: !!document.getElementById('r2-preserve-name').checked,
                    webpConvert: !!document.getElementById('r2-webp').checked,
                    webpQuality: parseInt(document.getElementById('r2-webp-quality').value, 10) || 80,
                    maxWidth: parseInt(document.getElementById('r2-max-width').value, 10) || 0
                };
                return fetch('/api/plugins/cloudflare-r2/data', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            };

            const testBtn = document.getElementById('r2-test');
            if (testBtn) {
                testBtn.addEventListener('click', async () => {
                    const result = document.getElementById('r2-test-result');
                    try {
                        await saveData();
                        if (result) { result.textContent = '测试中…'; result.style.color = ''; }
                        const res = await fetch('/api/plugins/cloudflare-r2/test', { method: 'POST' });
                        const json = await res.json();
                        if (res.ok) {
                            if (result) {
                                result.textContent = '✅ 连接成功，Buckets: ' + (json.buckets || []).join(', ');
                                result.style.color = '#28a745';
                            }
                        } else {
                            if (result) {
                                result.textContent = '❌ ' + (json.error || '连接失败');
                                result.style.color = '#dc3545';
                            }
                        }
                    } catch (e) {
                        if (result) {
                            result.textContent = '❌ ' + e.message;
                            result.style.color = '#dc3545';
                        }
                    }
                });
            }

            const uploadBtn = document.getElementById('r2-upload-btn');
            if (uploadBtn) {
                uploadBtn.addEventListener('click', async () => {
                    const fileInput = document.getElementById('r2-upload-file');
                    const result = document.getElementById('r2-upload-result');
                    if (!fileInput || !fileInput.files.length) {
                        if (result) result.textContent = '请先选择图片';
                        return;
                    }
                    uploadBtn.disabled = true;
                    try {
                        await saveData();
                        const fd = new FormData();
                        Array.from(fileInput.files).forEach(f => fd.append('images', f));
                        if (result) result.textContent = '上传中（' + fileInput.files.length + ' 张）…';
                        const res = await fetch('/api/plugins/cloudflare-r2/upload', { method: 'POST', body: fd });
                        const json = await res.json();
                        if (res.ok) {
                            const ok = (json.uploaded || []).length;
                            const errs = (json.errors || []).length;
                            const links = (json.uploaded || [])
                                .map(u => '<a href="' + window.AdminCMS.esc(u.url) + '" target="_blank">' + window.AdminCMS.esc(u.key) + '</a>')
                                .join('<br>');
                            let html = '✅ 上传成功 ' + ok + ' 张' + (errs ? '，失败 ' + errs + ' 张' : '') + '（已自动加入媒体库）<br>' + links;
                            if (errs) {
                                html += '<br>❌ ' + (json.errors || []).map(e => window.AdminCMS.esc(e.originalname) + ': ' + window.AdminCMS.esc(e.error)).join('<br>');
                            }
                            if (result) {
                                result.innerHTML = html;
                                result.style.color = errs ? '#dc3545' : '#28a745';
                            }
                            if (fileInput) fileInput.value = '';
                        } else {
                            if (result) {
                                result.textContent = '❌ ' + (json.error || '上传失败');
                                result.style.color = '#dc3545';
                            }
                        }
                    } catch (e) {
                        if (result) {
                            result.textContent = '❌ ' + e.message;
                            result.style.color = '#dc3545';
                        }
                    } finally {
                        uploadBtn.disabled = false;
                    }
                });
            }
        }
    });
})();
