(function () {
    'use strict';
    const C = window.SITE_CONFIG;
    const U = window.CMS.utils;

    window.CMS.registerModule('hello', function (mod, idx) {
        if (!mod || mod.visible === false) return '';
        const text = (mod.text || 'Hello from Plugin').toString();
        return `
<section class="section section--plugin section--hello" id="module-hello-${idx}" data-module="hello">
    <div class="section__head">
        <p class="section__label">PLUGIN</p>
        <h2 class="section__title">${U.esc(text)}</h2>
    </div>
    <p class="plugin-list__desc">这是一个由插件动态注册的模块。你可以删除或停用 hello-world 插件来验证插件系统。</p>
</section>`;
    }, { nav: { href: '#module-hello-0', text: 'Hello' } });
})();
