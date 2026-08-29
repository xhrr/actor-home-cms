(function () {
    'use strict';
    if (!window.AdminCMS) return;

    window.AdminCMS.registerPluginPanel('hello-world', {
        label: 'Hello World',
        render: function (data) {
            return `
                <div class="form-group">
                    <label>显示文字</label>
                    <input type="text" id="hello-text" value="${window.AdminCMS.esc((data && data.text) || 'Hello from Plugin')}">
                </div>
                <div class="form-group">
                    <label>说明</label>
                    <p class="form-help">这是插件后台面板示例。你可以在插件管理页看到它。</p>
                </div>
            `;
        },
        collect: function () {
            return {
                text: document.getElementById('hello-text') ? document.getElementById('hello-text').value : ''
            };
        }
    });
})();
