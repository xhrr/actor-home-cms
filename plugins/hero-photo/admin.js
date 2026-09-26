(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('hero-photo', {
        label: '首页粒子 hero',
        render: function (data) {
            data = data || {};
            var shape = data.shape == null ? 'moon' : data.shape;
            var opts = [
                ['moon', '月牙（默认）'],
                ['heart', '心形'],
                ['star', '五角星'],
                ['crown', '皇冠'],
                ['flower', '花开'],
                ['random', '每次随机']
            ].map(function (o) {
                return '<option value="' + o[0] + '"' + (shape === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('');
            var tone = data.tone == null ? 'light' : data.tone;
            return '<div class="form-group">' +
                '<label class="toggle-label">' +
                '<input type="checkbox" id="hpp-enabled" ' + (data.enabled !== false ? 'checked' : '') + '> 启用点击聚形特效' +
                '</label>' +
                '<p class="form-help">关闭后点击 hero 不再触发聚形动画；暗色排版与粒子场仍生效。也可在插件列表里整体停用本插件。</p>' +
                '</div>' +
                '<div class="form-group">' +
                '<label>点击汇聚形状</label>' +
                '<select id="hpp-shape">' + opts + '</select>' +
                '<p class="form-help">点击 hero 空白处时，全部粒子汇聚成的形状；「每次随机」在五种形状中随机。</p>' +
                '</div>' +
                '<div class="form-group">' +
                '<label>明暗调</label>' +
                '<select id="hpp-tone">' +
                '<option value="light"' + (tone === 'dark' ? '' : ' selected') + '>明调（米白滤镜）</option>' +
                '<option value="dark"' + (tone === 'dark' ? ' selected' : '') + '>暗调（电影感）</option>' +
                '</select>' +
                '<p class="form-help">明调 = 底部米白渐变 + 墨色文字 + 金粉发光珠；暗调 = 整体压暗 + 暖白星尘。修改后刷新首页生效；公共站需重新导出后生效。</p>' +
                '</div>';
        },
        collect: function () {
            var shape = document.getElementById('hpp-shape');
            return {
                enabled: document.getElementById('hpp-enabled') ? document.getElementById('hpp-enabled').checked : true,
                shape: shape ? shape.value : 'moon',
                tone: (function () { var t = document.getElementById('hpp-tone'); return t ? t.value : 'light'; })()
            };
        }
    });
})();
