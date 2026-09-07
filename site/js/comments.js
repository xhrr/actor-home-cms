/**
 * 站点评论（杂志风展示 + 发布留言）
 * 数据：导出固化的 SITE_CONFIG.comments（审批制：评论经 GitHub Issue 人工审批后写入）。
 * 发布：POST 同源 /api/comments（NAS/CMS 端点）；公共静态站未配置提交端点时表单自动降级提示。
 * 页面标识：图集详情 = album-{序号}；动态页 = news。
 * 展示策略：开关开启时评论区常显（无留言显示空状态 + 表单，访客可发首条）；
 *          「评论管理」一键关闭（commentsEnabled=false）时全站零渲染。
 */
(function () {
    'use strict';

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    const NICK_KEY = 'comment-nickname';
    const state = { pageKey: null, replyTo: null, replyName: '' };

    function commentsFor(pageKey) {
        const all = (window.SITE_CONFIG && window.SITE_CONFIG.comments) || {};
        return Array.isArray(all[pageKey]) ? all[pageKey] : [];
    }

    /** 评论功能总开关（后台「评论管理」一键关闭 → 导出注入 commentsEnabled=false → 全站零渲染） */
    function commentsEnabled() {
        return !(window.SITE_CONFIG && window.SITE_CONFIG.commentsEnabled === false);
    }

    /** 组装两级楼中楼：主评论 + 其回复（回复的回复向上归入同一主评论，展示为 回复 @昵称） */
    function buildThreads(list) {
        const byId = {};
        list.forEach(c => { byId[c.id] = c; });
        const rootOf = c => {
            let cur = c;
            while (cur.replyTo && byId[cur.replyTo]) cur = byId[cur.replyTo];
            return cur.id;
        };
        const roots = [], replies = {};
        list.forEach(c => {
            const rid = rootOf(c);
            if (rid === c.id) roots.push(c);
            else (replies[rid] = replies[rid] || []).push(c);
        });
        return { byId, roots, replies };
    }

    const pad2 = n => String(n).padStart(2, '0');
    const fmtDate = d => String(d || '').replace(/-/g, '.');

    function headHtml(c, ref) {
        return `
            <div class="comment__head">
                <span class="comment__name">${esc(c.n || '马铃薯')}</span>
                ${ref ? `<span class="comment__ref">${esc(ref)}</span>` : ''}
                <span class="comment__date">${fmtDate(c.d)}</span>
                <button type="button" class="comment__reply" data-reply="${esc(c.id)}" data-reply-name="${esc(c.n || '马铃薯')}">回复</button>
            </div>`;
    }

    function sectionHtml() {
        const list = commentsFor(state.pageKey);
        const { byId, roots, replies } = buildThreads(list);
        let num = 0;
        const thread = c => {
            const reps = replies[c.id] || [];
            return `
            <li class="comment">
                <span class="comment__num">${pad2(++num)}</span>
                <div class="comment__main">
                    ${headHtml(c)}
                    <p class="comment__text">${esc(c.t)}</p>
                    ${reps.length ? `
                    <ul class="comment__replies">
                        ${reps.map(r => {
                            const parent = byId[r.replyTo];
                            const ref = parent && parent.id !== c.id ? `回复 @${parent.n || '匿名'}` : '';
                            return `
                            <li class="comment comment--reply">
                                <span class="comment__num">${pad2(++num)}</span>
                                <div class="comment__main">
                                    ${headHtml(r, ref)}
                                    <p class="comment__text">${esc(r.t)}</p>
                                </div>
                            </li>`;
                        }).join('')}
                    </ul>` : ''}
                </div>
            </li>`;
        };
        let nick = '';
        try { nick = localStorage.getItem(NICK_KEY) || ''; } catch (e) { /* 隐私模式 */ }
        return `
        <section class="comments" id="commentsSection">
            <div class="section__head">
                <p class="section__label">COMMENTS</p>
                <h2 class="section__title">留言<sup class="comments__count">${list.length}</sup></h2>
            </div>
            <ul class="comments__list">${roots.map(thread).join('') || '<li class="comments__empty">还没有留言，来写下第一条吧</li>'}</ul>
            <form class="comments__form" id="commentsForm">
                <div class="comments__form-row">
                    <input type="text" class="comments__input" id="commentNickname" placeholder="昵称（选填，默认马铃薯）" maxlength="20" autocomplete="off" value="${esc(nick)}">
                    <span class="comments__replying" id="commentsReplying" style="display:none" title="点击取消回复"></span>
                    <button type="submit" class="comments__submit">发 布</button>
                </div>
                <textarea class="comments__input comments__textarea" id="commentContent" rows="3" maxlength="500" placeholder="写下你的留言…"></textarea>
                <p class="comments__form-hint">留言经整理后展示，请友善发言</p>
            </form>
        </section>`;
    }

    function setReply(id, name) {
        state.replyTo = id || null;
        state.replyName = name || '';
        const section = document.getElementById('commentsSection');
        if (!section) return;
        const chip = section.querySelector('#commentsReplying');
        const ta = section.querySelector('#commentContent');
        if (state.replyTo) {
            chip.textContent = '回复 @' + state.replyName + ' ×';
            chip.style.display = '';
            if (ta) { ta.placeholder = '回复 @' + state.replyName + '：'; ta.focus(); }
        } else {
            chip.style.display = 'none';
            if (ta) ta.placeholder = '写下你的留言…';
        }
    }

    /** 轻弹窗反馈：比表单 hint 更明显（底部居中，3s 自动消退） */
    let toastTimer = null;
    function showToast(msg) {
        let el = document.getElementById('commentsToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'commentsToast';
            el.className = 'comments-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        void el.offsetWidth; // 强制回流，让重复触发时淡入过渡重新播放
        el.classList.add('is-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('is-show'), 3000);
    }

    function submitForm(section) {
        const nickEl = section.querySelector('#commentNickname');
        const ta = section.querySelector('#commentContent');
        const hint = section.querySelector('.comments__form-hint');
        const content = ta.value.trim();
        if (!content) { hint.textContent = '写点什么再发布吧'; return; }
        const payload = {
            page: state.pageKey,
            nickname: nickEl.value.trim(),
            content,
            replyTo: state.replyTo || ''
        };
        const endpoint = window.COMMENTS_ENDPOINT || '/api/comments';
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(r => {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.json();
        }).then(j => {
            try { localStorage.setItem(NICK_KEY, nickEl.value.trim()); } catch (e) { /* 隐私模式 */ }
            if (j && j.pending) {
                // 公共站待审通道（comment-gateway）：不落本地展示，等审批固化后的导出上线
                state.replyTo = null; state.replyName = '';
                ta.value = '';
                const msg = j.message || '留言已提交，审核通过后展示';
                hint.textContent = msg;
                showToast(msg);
                return;
            }
            const all = (window.SITE_CONFIG.comments = window.SITE_CONFIG.comments || {});
            const list = all[state.pageKey] = all[state.pageKey] || [];
            list.push(j.comment);
            state.replyTo = null; state.replyName = '';
            rerender();
            showToast('留言已发布');
        }).catch(() => {
            hint.textContent = '评论提交暂未开放，敬请期待';
            showToast('评论提交暂未开放，敬请期待');
        });
    }

    function rerender() {
        const old = document.getElementById('commentsSection');
        if (!old) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = sectionHtml();
        const fresh = tmp.firstElementChild;
        old.replaceWith(fresh);
        bindSection(fresh);
    }

    function bindSection(section) {
        section.addEventListener('click', e => {
            const btn = e.target.closest('[data-reply]');
            if (btn) {
                setReply(btn.dataset.reply, btn.dataset.replyName);
                return;
            }
            if (e.target.closest('#commentsReplying')) setReply(null);
        });
        section.querySelector('#commentsForm').addEventListener('submit', e => {
            e.preventDefault();
            submitForm(section);
        });
    }

    function render(pageKey, mountEl, position) {
        if (!commentsEnabled() || !mountEl) return null;
        if (document.getElementById('commentsSection')) return null; // 防脚本顺序变化导致的双渲染
        state.pageKey = pageKey;
        mountEl.insertAdjacentHTML(position || 'afterend', sectionHtml());
        const section = document.getElementById('commentsSection');
        bindSection(section);
        return section;
    }

    /** 自动接入：图集详情页（?album=N 且专辑存在）/ 动态页 */
    function autoInit() {
        const params = new URLSearchParams(window.location.search);
        const album = params.get('album');
        // 页面名去扩展名匹配：公共站（Pages）会把 /gallery.html 308 到 /gallery，写死 .html 永远不匹配（事故 14）
        const path = (window.location.pathname.replace(/\/+$/, '').split('/').pop() || '').replace(/\.html?$/i, '');
        const grid = document.getElementById('galleryGrid');
        if (path === 'gallery' && album !== null && grid) {
            const albums = (window.SITE_CONFIG.gallery || {}).albums || [];
            const hit = albums.find(a => a.id && a.id === album) || (/^\d+$/.test(album) ? albums[+album] : null);
            if (hit && hit.id) render('album-' + hit.id, grid, 'afterend');
            return;
        }
        const workId = params.get('work');
        if (path === 'gallery' && workId !== null && grid) {
            const works = (window.SITE_CONFIG.works || {}).categories || [];
            let hit = null;
            works.forEach(cat => (cat.items || []).forEach(it => { if (it.id === workId) hit = it; }));
            if (hit) render('work-' + hit.id, grid, 'afterend');
            return;
        }
        if (path === 'news') {
            const app = document.getElementById('app');
            if (app) render('news', app, 'beforeend');
        }
    }

    window.Comments = { render, commentsFor };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit);
    else autoInit();
})();
