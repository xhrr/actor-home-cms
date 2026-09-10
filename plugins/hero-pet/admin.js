(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('hero-pet', {
        label: '首页 Q 版宠物',
        render: function (data) {
            data = data || {};
            var size = data.size != null ? data.size : 96;
            var stride = data.hopStride != null ? data.hopStride : 110;
            var hopH = data.hopHeight != null ? data.hopHeight : 30;
            var hopD = data.hopDuration != null ? data.hopDuration : 340;
            return `
                <div class="form-group">
                    <label class="toggle-label">
                        <input type="checkbox" id="hp-enabled" ${data.enabled !== false ? 'checked' : ''}> 显示宠物
                    </label>
                    <p class="form-help">关闭后首页不再显示；也可在插件列表里整体停用本插件。</p>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>宠物高度（px）</label>
                        <input type="number" id="hp-size" min="48" max="220" value="${window.AdminCMS.esc(String(size))}">
                    </div>
                    <div class="form-group">
                        <label>跳跃高度（px）</label>
                        <input type="number" id="hp-hoph" min="6" max="120" value="${window.AdminCMS.esc(String(hopH))}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>每跳距离（px）</label>
                        <input type="number" id="hp-stride" min="30" max="400" value="${window.AdminCMS.esc(String(stride))}">
                        <p class="form-help">每一次蹦跳前进的水平距离，越小跳得越密。</p>
                    </div>
                    <div class="form-group">
                        <label>单跳时长（毫秒）</label>
                        <input type="number" id="hp-hopd" min="140" max="1200" step="20" value="${window.AdminCMS.esc(String(hopD))}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>落回时长（毫秒）</label>
                        <input type="number" id="hp-fall" min="300" max="6000" step="100" value="${window.AdminCMS.esc(String(data.fallDuration != null ? data.fallDuration : 1800))}">
                        <p class="form-help">拖拽松手后落回分界线的时长，越大越缓慢。</p>
                    </div>
                    <div class="form-group">
                        <label>初始位置</label>
                        <select id="hp-side">
                            <option value="right" ${data.startSide !== 'left' ? 'selected' : ''}>右下角（默认）</option>
                            <option value="left" ${data.startSide === 'left' ? 'selected' : ''}>左下角</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="toggle-label">
                            <input type="checkbox" id="hp-clickmove" ${data.clickMove !== false ? 'checked' : ''}> 允许点击首页移动
                        </label>
                        <label class="toggle-label">
                            <input type="checkbox" id="hp-draggable" ${data.draggable !== false ? 'checked' : ''}> 允许鼠标 / 手指拖动
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <p class="form-help">宠物（小博美）静默时趴在 hero 与下一板块的分界线上；点击首页空白会<b>站起来蹦蹦跳跳</b>过去，到达后重新趴下。向下滚动时跟随分界线上移并淡出；拖动松手后会缓缓落回分界线。修改后刷新首页即可看到效果；公共站需重新导出后生效。</p>
                </div>
            `;
        },
        collect: function () {
            var num = function (id, d) {
                var el = document.getElementById(id);
                var v = el ? parseInt(el.value, 10) : NaN;
                return (isNaN(v) ? d : v);
            };
            var side = document.getElementById('hp-side');
            return {
                enabled: document.getElementById('hp-enabled') ? document.getElementById('hp-enabled').checked : true,
                size: num('hp-size', 96),
                hopStride: num('hp-stride', 110),
                hopHeight: num('hp-hoph', 30),
                hopDuration: num('hp-hopd', 340),
                clickMove: document.getElementById('hp-clickmove') ? document.getElementById('hp-clickmove').checked : true,
                draggable: document.getElementById('hp-draggable') ? document.getElementById('hp-draggable').checked : true,
                fallDuration: num("hp-fall", 1800),
                startSide: side ? side.value : 'right'
            };
        }
    });
})();
