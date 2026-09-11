/**
 * Actor Home CMS — 运行时国际化（P0/P1）
 *
 * 设计（与 START_HERE「方案 A」一致）：
 *  - 词典内联在本文件，同步加载 → 渲染脚本执行前 T 已就位，无 FOUC；
 *  - 切换语言 = 整页跳转（?lang= 优先 → localStorage → <html lang>），
 *    不做无刷新热切换，避免 gallery 瀑布流重渲染与 GSAP/Lenis 实例泄漏；
 *  - 渲染时查词典（字符串拼接阶段），不做「渲染后遍历 DOM 改写」；
 *  - 缺失 key 一律回退调用方给的中文默认值，保证任何语言下都不留空。
 *
 * 用法：
 *   T('nav.about', '关于')                  → 取词，缺失回退第二参
 *   T('unit.photo', ' 张')                  → 量词等也走词典
 *   I18N.pick(obj, 'heading')               → 内容字段多语言（obj.heading_i18n[locale] ?? obj.heading）
 *   I18N.langSwitchHtml() / bindLangSwitch()→ 导航栏语言切换控件
 */
(function () {
    'use strict';

    const DEFAULT_LOCALE = 'zh-CN';

    /* 词典：键名稳定，值可随时扩充。zh-CN 与代码内默认值一致，便于逐条迁移。 */
    const DICTS = {
        'zh-CN': {
            'nav.home': '首页',
            'nav.about': '关于',
            'nav.works': '作品',
            'nav.gallery': '写真',
            'nav.news': '动态',
            'nav.awards': '荣誉',
            'nav.schedule': '行程',
            'nav.groups': '群组',
            'nav.footer': '联系',
            'nav.menu': '菜单',

            'common.all': '全部',
            'common.originalLink': '原始链接 ↗',
            'common.viewOriginal': '查看原始链接 ↗',
            'common.copyLink': '复制链接',
            'common.copied': '已复制 ✓',
            'common.copyFailed': '复制失败',
            'common.share': '分享',
            'common.close': '关闭',
            'common.prev': '上一张',
            'common.next': '下一张',
            'common.zoomPreview': '放大预览',

            'unit.photo': ' 张',
            'unit.item': ' 条',
            'unit.monthSuffix': '月',

            'about.title': '关于演员',

            'works.title': '代表作品',
            'works.searchPlaceholder': '搜索作品标题 / 角色 / 导演 / 类型…',
            'works.rolePrefix': '饰演 ',
            'works.emptySearch': '未找到匹配的作品',
            'works.viewAll': '查看全部作品',

            'news.title': '最新动态',
            'news.empty': '暂无动态',
            'news.viewAll': '查看全部动态',

            'awards.title': '荣誉奖项',
            'awards.empty': '暂无奖项',
            'awards.viewAll': '查看全部荣誉',

            'schedule.title': '近期行程',
            'schedule.empty': '暂无行程',
            'schedule.viewAll': '查看全部行程',

            'gallery.title': '写真',
            'gallery.count': '共 {n} 个写真集',
            'gallery.countUnit': ' 个写真集',
            'gallery.searchPlaceholder': '搜索写真集标题 / 作者…',
            'gallery.emptySearch': '未找到匹配的写真集',
            'gallery.emptyTime': '这个时间段还没有写真集',
            'gallery.emptyDefault': '暂无写真集',
            'gallery.albumFallback': '写真集',
            'gallery.authorPrefix': '作者：',
            'gallery.back': '← 返回写真集',
            'gallery.emptyAlbum': '这个写真集还没有照片',
            'gallery.altPhoto': '写真 {n}',
            'gallery.viewAll': '查看全部写真',

            'workGallery.back': '← 返回作品',
            'workGallery.fallback': '作品图集',
            'workGallery.empty': '这个作品还没有剧照',
            'workGallery.altStill': '剧照 {n}',

            'groups.title': '粉丝群组',
            'groups.groupFallback': '粉丝群',
            'groups.filterCountry': '国家',
            'groups.filterRegion': '地区',
            'groups.adminPrefix': '管理员：',
            'groups.emptyFilter': '该筛选下暂无群组',
            'groups.countTpl': '筛选出 {shown} / {total} 个群组',
            'groups.viewAll': '查看全部群组',

            'comments.title': '留言',
            'comments.empty': '还没有留言，来写下第一条吧',
            'comments.nickPlaceholder': '昵称（选填，默认马铃薯）',
            'comments.cancelReply': '点击取消回复',
            'comments.submit': '发 布',
            'comments.textareaPlaceholder': '写下你的留言…',
            'comments.replyPrefix': '回复 @',
            'comments.replyBtn': '回复',
            'comments.hint': '留言经整理后展示，请友善发言',
            'comments.needContent': '写点什么再发布吧',
            'comments.published': '留言已发布',
            'comments.pending': '留言已提交，审核通过后展示',
            'comments.closed': '评论提交暂未开放，敬请期待',
            'comments.anonymous': '匿名',
            'comments.defaultName': '马铃薯',

            'footer.creditsTitle': '制作组',
            'footer.disclaimer': '免责声明',
            'footer.shareSite': '分享本站',

            'share.label': '分享',
            'share.generating': '海报生成中…',
            'share.save': '保存图片',
            'share.posterAlt': '分享海报',
            'share.noPoster': '未配置分享海报，可直接复制链接',
            'share.posterFailed': '海报加载失败，可直接复制链接',

            'motion.scrollHint': '下滑探索',
            'page.unknown': '未知页面类型',
            'title.index': '演员主页',
            'title.about': '关于演员',
            'title.works': '代表作品',
            'title.gallery': '写真',
            'title.news': '最新动态',
            'title.awards': '荣誉奖项',
            'title.schedule': '近期行程',
            'title.groups': '粉丝群组',
            'title.contribute': '投稿',

            'contrib.pageTitle': '投稿',
            'contrib.typeAlbum': '图 集',
            'contrib.typeWorks': '作 品',
            'contrib.typeAppend': '补 充',
            'contrib.targetIdLabel': '目标 ID *',
            'contrib.targetIdPlaceholder': '粘贴详情页链接，或填 a-xxxx / w-xxxx',
            'contrib.targetIdHelp': '要往哪个已有图集 / 作品里补图？打开该内容的详情页，复制地址栏链接粘贴到此处即可（也可只填 ID 部分）。',
            'contrib.dateLabel': '发帖日期 *',
            'contrib.authorLabel': '作者 / 摄影师 *',
            'contrib.authorPlaceholder': '摄影师或内容创作者',
            'contrib.categoryLabel': '分类 *',
            'contrib.yearLabel': '年份 *',
            'contrib.yearPlaceholder': '2026 或 2026-03-01',
            'contrib.directorLabel': '导演',
            'contrib.roleLabel': '饰演角色 *',
            'contrib.synopsisLabel': '简介 *',
            'contrib.pickHint': '点击选择图片（可多选），或拖拽文件 / 文件夹到此处',
            'contrib.thumbHelp': '点击图片可设为封面（作品为海报）；上传到站内图床，格式自动转为 webp。',
            'contrib.note': '提交后经人工审核上线；请确认图片有权分享。投稿内容将进入待审队列，不会立即展示。选「补充」可为已有图集 / 作品追加图片：打开该内容详情页，复制链接填入「目标 ID」即可。',


            'contrib.titleLabel': '标题 *',
            'contrib.required': '必填',
            'contrib.sourceOptional': '原始链接（选填）',
            'contrib.sourceRequired': '原始链接 *',
            'contrib.optional': '选填',
            'contrib.imgAppend': '要补充的图片 *（最多 30 张，自动压缩为 webp）',
            'contrib.imgAlbum': '图片 *（最多 30 张，自动压缩为 webp）',
            'contrib.imgWorks': '剧照 *（最多 30 张，第一张作为海报，自动压缩为 webp）',
            'contrib.readFail': '无法读取图片：',
            'contrib.encodeFail': '图片编码失败：',
            'contrib.poster': '海报',
            'contrib.cover': '封面',
            'contrib.remove': '移除',
            'contrib.maxImages': '最多 {n} 张',
            'contrib.uploading': '上传中 {n}%',
            'contrib.submit': '提 交 投 稿',
            'contrib.needTargetId': '请填写要补充的内容 ID（详情页链接或 a-xxxx / w-xxxx）',
            'contrib.needTitle': '请填写标题',
            'contrib.needDate': '请选择发帖日期',
            'contrib.needAuthor': '请填写作者 / 摄影师',
            'contrib.needSource': '请填写原始链接（http/https 开头）',
            'contrib.needCategory': '请选择分类',
            'contrib.needYear': '请填写年份',
            'contrib.needRole': '请填写饰演角色',
            'contrib.needSynopsis': '请填写简介',
            'contrib.needImage': '请至少选择一张图片',
            'contrib.submitted': '投稿已提交，审核通过后上线',
            'contrib.networkError': '网络错误或超时，请检查网络后重试',
            'contrib.serviceDown': '投稿服务暂时不可用（{n}），请稍后再试',
            'contrib.uploadFail': '❌ 上传失败：',
        },

        'en': {
            'nav.home': 'Home',
            'nav.about': 'About',
            'nav.works': 'Works',
            'nav.gallery': 'Gallery',
            'nav.news': 'News',
            'nav.awards': 'Awards',
            'nav.schedule': 'Schedule',
            'nav.groups': 'Groups',
            'nav.footer': 'Contact',
            'nav.menu': 'Menu',

            'common.all': 'All',
            'common.originalLink': 'Original ↗',
            'common.viewOriginal': 'View source ↗',
            'common.copyLink': 'Copy link',
            'common.copied': 'Copied ✓',
            'common.copyFailed': 'Copy failed',
            'common.share': 'Share',
            'common.close': 'Close',
            'common.prev': 'Previous',
            'common.next': 'Next',
            'common.zoomPreview': 'Zoomed preview',

            'unit.photo': ' photos',
            'unit.item': ' items',
            'unit.monthSuffix': '',

            'about.title': 'About',

            'works.title': 'Selected Works',
            'works.searchPlaceholder': 'Search title / role / director / genre…',
            'works.rolePrefix': 'as ',
            'works.emptySearch': 'No matching works',
            'works.viewAll': 'View all works',

            'news.title': 'Latest News',
            'news.empty': 'No news yet',
            'news.viewAll': 'View all news',

            'awards.title': 'Awards',
            'awards.empty': 'No awards yet',
            'awards.viewAll': 'View all awards',

            'schedule.title': 'Schedule',
            'schedule.empty': 'No schedule yet',
            'schedule.viewAll': 'View all schedule',

            'gallery.title': 'Gallery',
            'gallery.count': '{n} albums',
            'gallery.countUnit': ' albums',
            'gallery.searchPlaceholder': 'Search album title / author…',
            'gallery.emptySearch': 'No matching albums',
            'gallery.emptyTime': 'No albums in this period',
            'gallery.emptyDefault': 'No albums yet',
            'gallery.albumFallback': 'Album',
            'gallery.authorPrefix': 'By ',
            'gallery.back': '← Back to gallery',
            'gallery.emptyAlbum': 'This album has no photos yet',
            'gallery.altPhoto': 'Photo {n}',
            'gallery.viewAll': 'View all albums',

            'workGallery.back': '← Back to works',
            'workGallery.fallback': 'Work gallery',
            'workGallery.empty': 'No stills for this work yet',
            'workGallery.altStill': 'Still {n}',

            'groups.title': 'Fan Groups',
            'groups.groupFallback': 'Fan group',
            'groups.filterCountry': 'Country',
            'groups.filterRegion': 'Region',
            'groups.adminPrefix': 'Admin: ',
            'groups.emptyFilter': 'No groups in this filter',
            'groups.countTpl': 'Showing {shown} / {total} groups',
            'groups.viewAll': 'View all groups',

            'comments.title': 'Comments',
            'comments.empty': 'No comments yet — be the first',
            'comments.nickPlaceholder': 'Nickname (optional)',
            'comments.cancelReply': 'Click to cancel reply',
            'comments.submit': 'Post',
            'comments.textareaPlaceholder': 'Write a comment…',
            'comments.replyPrefix': 'Reply @',
            'comments.replyBtn': 'Reply',
            'comments.hint': 'Comments are reviewed before publishing. Be kind.',
            'comments.needContent': 'Write something first',
            'comments.published': 'Comment posted',
            'comments.pending': 'Submitted — visible after review',
            'comments.closed': 'Comments are temporarily closed',
            'comments.anonymous': 'Anonymous',
            'comments.defaultName': 'Guest',

            'footer.creditsTitle': 'Credits',
            'footer.disclaimer': 'Disclaimer',
            'footer.shareSite': 'Share this site',

            'share.label': 'Share',
            'share.generating': 'Generating poster…',
            'share.save': 'Save image',
            'share.posterAlt': 'Share poster',
            'share.noPoster': 'No poster configured — copy the link instead',
            'share.posterFailed': 'Poster failed to load — copy the link instead',

            'motion.scrollHint': 'Scroll to explore',
            'page.unknown': 'Unknown page type',
            'title.index': 'Home',
            'title.about': 'About',
            'title.works': 'Selected Works',
            'title.gallery': 'Gallery',
            'title.news': 'Latest News',
            'title.awards': 'Awards',
            'title.schedule': 'Schedule',
            'title.groups': 'Fan Groups',
            'title.contribute': 'Contribute',

            'contrib.pageTitle': 'Contribute',
            'contrib.typeAlbum': 'Album',
            'contrib.typeWorks': 'Work',
            'contrib.typeAppend': 'Append',
            'contrib.targetIdLabel': 'Target ID *',
            'contrib.targetIdPlaceholder': 'Paste a detail-page link, or a-xxxx / w-xxxx',
            'contrib.targetIdHelp': 'Which existing album / work are you adding to? Open its detail page, copy the URL and paste it here (the ID alone also works).',
            'contrib.dateLabel': 'Post date *',
            'contrib.authorLabel': 'Author / Photographer *',
            'contrib.authorPlaceholder': 'Photographer or creator',
            'contrib.categoryLabel': 'Category *',
            'contrib.yearLabel': 'Year *',
            'contrib.yearPlaceholder': '2026 or 2026-03-01',
            'contrib.directorLabel': 'Director',
            'contrib.roleLabel': 'Role *',
            'contrib.synopsisLabel': 'Synopsis *',
            'contrib.pickHint': 'Click to choose images (multi-select), or drag files / folders here',
            'contrib.thumbHelp': 'Click an image to set it as cover (poster for works); uploads are stored on our CDN and converted to webp.',
            'contrib.note': 'Submissions go live after manual review; please make sure you have the rights to share the images. Content enters a pending queue and is not shown immediately. Choose "Append" to add images to an existing album / work: open its detail page and paste the link into "Target ID".',


            'contrib.titleLabel': 'Title *',
            'contrib.required': 'Required',
            'contrib.sourceOptional': 'Source URL (optional)',
            'contrib.sourceRequired': 'Source URL *',
            'contrib.optional': 'Optional',
            'contrib.imgAppend': 'Images to append * (max 30, auto-compressed to webp)',
            'contrib.imgAlbum': 'Images * (max 30, auto-compressed to webp)',
            'contrib.imgWorks': 'Stills * (max 30, first one as poster, auto-compressed to webp)',
            'contrib.readFail': 'Cannot read image: ',
            'contrib.encodeFail': 'Image encoding failed: ',
            'contrib.poster': 'Poster',
            'contrib.cover': 'Cover',
            'contrib.remove': 'Remove',
            'contrib.maxImages': 'Max {n} images',
            'contrib.uploading': 'Uploading {n}%',
            'contrib.submit': 'Submit',
            'contrib.needTargetId': 'Enter the target ID (detail link or a-xxxx / w-xxxx)',
            'contrib.needTitle': 'Please enter a title',
            'contrib.needDate': 'Please select a post date',
            'contrib.needAuthor': 'Please enter the author / photographer',
            'contrib.needSource': 'Please enter a source URL (http/https)',
            'contrib.needCategory': 'Please select a category',
            'contrib.needYear': 'Please enter a year',
            'contrib.needRole': 'Please enter the role',
            'contrib.needSynopsis': 'Please enter a synopsis',
            'contrib.needImage': 'Please select at least one image',
            'contrib.submitted': 'Submitted — online after review',
            'contrib.networkError': 'Network error or timeout, please retry',
            'contrib.serviceDown': 'Submission service unavailable ({n}), please retry later',
            'contrib.uploadFail': '❌ Upload failed: ',
        },
        'vi': {
            'nav.home': 'Trang chủ',
            'nav.about': 'Giới thiệu',
            'nav.works': 'Tác phẩm',
            'nav.gallery': 'Album ảnh',
            'nav.news': 'Tin tức',
            'nav.awards': 'Giải thưởng',
            'nav.schedule': 'Lịch trình',
            'nav.groups': 'Nhóm fan',
            'nav.footer': 'Liên hệ',
            'nav.menu': 'Menu',

            'common.all': 'Tất cả',
            'common.originalLink': 'Liên kết gốc ↗',
            'common.viewOriginal': 'Xem liên kết gốc ↗',
            'common.copyLink': 'Sao chép liên kết',
            'common.copied': 'Đã sao chép ✓',
            'common.copyFailed': 'Sao chép thất bại',
            'common.share': 'Chia sẻ',
            'common.close': 'Đóng',
            'common.prev': 'Ảnh trước',
            'common.next': 'Ảnh sau',
            'common.zoomPreview': 'Xem ảnh phóng to',

            'unit.photo': ' ảnh',
            'unit.item': ' mục',
            'unit.monthSuffix': '',

            'about.title': 'Giới thiệu diễn viên',

            'works.title': 'Tác phẩm tiêu biểu',
            'works.searchPlaceholder': 'Tìm tên tác phẩm / vai diễn / đạo diễn / thể loại…',
            'works.rolePrefix': 'vai ',
            'works.emptySearch': 'Không tìm thấy tác phẩm phù hợp',
            'works.viewAll': 'Xem tất cả tác phẩm',

            'news.title': 'Tin mới nhất',
            'news.empty': 'Chưa có tin tức',
            'news.viewAll': 'Xem tất cả tin tức',

            'awards.title': 'Giải thưởng',
            'awards.empty': 'Chưa có giải thưởng',
            'awards.viewAll': 'Xem tất cả giải thưởng',

            'schedule.title': 'Lịch trình',
            'schedule.empty': 'Chưa có lịch trình',
            'schedule.viewAll': 'Xem tất cả lịch trình',

            'gallery.title': 'Album ảnh',
            'gallery.count': '{n} album ảnh',
            'gallery.countUnit': ' album ảnh',
            'gallery.searchPlaceholder': 'Tìm album ảnh / tác giả…',
            'gallery.emptySearch': 'Không tìm thấy album phù hợp',
            'gallery.emptyTime': 'Chưa có album trong khoảng thời gian này',
            'gallery.emptyDefault': 'Chưa có album ảnh',
            'gallery.albumFallback': 'Album ảnh',
            'gallery.authorPrefix': 'Tác giả: ',
            'gallery.back': '← Quay lại album ảnh',
            'gallery.emptyAlbum': 'Album này chưa có ảnh',
            'gallery.altPhoto': 'Ảnh {n}',
            'gallery.viewAll': 'Xem tất cả album',

            'workGallery.back': '← Quay lại tác phẩm',
            'workGallery.fallback': 'Album tác phẩm',
            'workGallery.empty': 'Tác phẩm này chưa có ảnh',
            'workGallery.altStill': 'Ảnh phim {n}',

            'groups.title': 'Nhóm người hâm mộ',
            'groups.groupFallback': 'Nhóm fan',
            'groups.filterCountry': 'Quốc gia',
            'groups.filterRegion': 'Khu vực',
            'groups.adminPrefix': 'Quản trị: ',
            'groups.emptyFilter': 'Không có nhóm nào trong bộ lọc này',
            'groups.countTpl': 'Hiển thị {shown} / {total} nhóm',
            'groups.viewAll': 'Xem tất cả nhóm',

            'comments.title': 'Bình luận',
            'comments.empty': 'Chưa có bình luận — hãy là người đầu tiên',
            'comments.nickPlaceholder': 'Biệt danh (không bắt buộc)',
            'comments.cancelReply': 'Nhấn để hủy trả lời',
            'comments.submit': 'GỬI',
            'comments.textareaPlaceholder': 'Viết bình luận…',
            'comments.replyPrefix': 'Trả lời @',
            'comments.replyBtn': 'Trả lời',
            'comments.hint': 'Bình luận sẽ được duyệt trước khi hiển thị. Hãy văn minh.',
            'comments.needContent': 'Hãy viết gì đó trước',
            'comments.published': 'Đã đăng bình luận',
            'comments.pending': 'Đã gửi — hiển thị sau khi duyệt',
            'comments.closed': 'Tạm thời đóng bình luận',
            'comments.anonymous': 'Ẩn danh',
            'comments.defaultName': 'Khách',

            'footer.creditsTitle': 'Nhóm thực hiện',
            'footer.disclaimer': 'Miễn trừ trách nhiệm',
            'footer.shareSite': 'Chia sẻ trang web',

            'share.label': 'Chia sẻ',
            'share.generating': 'Đang tạo poster…',
            'share.save': 'Lưu ảnh',
            'share.posterAlt': 'Poster chia sẻ',
            'share.noPoster': 'Chưa cấu hình poster — hãy sao chép liên kết',
            'share.posterFailed': 'Không tải được poster — hãy sao chép liên kết',

            'motion.scrollHint': 'Cuộn để khám phá',
            'page.unknown': 'Loại trang không xác định',
            'title.index': 'Trang chủ',
            'title.about': 'Giới thiệu diễn viên',
            'title.works': 'Tác phẩm tiêu biểu',
            'title.gallery': 'Album ảnh',
            'title.news': 'Tin mới nhất',
            'title.awards': 'Giải thưởng',
            'title.schedule': 'Lịch trình',
            'title.groups': 'Nhóm người hâm mộ',
            'title.contribute': 'Gửi bài',

            'contrib.pageTitle': 'Gửi bài',
            'contrib.typeAlbum': 'Album',
            'contrib.typeWorks': 'Tác phẩm',
            'contrib.typeAppend': 'Bổ sung',
            'contrib.targetIdLabel': 'ID mục tiêu *',
            'contrib.targetIdPlaceholder': 'Dán liên kết trang chi tiết, hoặc a-xxxx / w-xxxx',
            'contrib.targetIdHelp': 'Bạn muốn thêm ảnh vào album / tác phẩm nào? Mở trang chi tiết của nội dung đó, sao chép liên kết rồi dán vào đây (chỉ cần ID cũng được).',
            'contrib.dateLabel': 'Ngày đăng *',
            'contrib.authorLabel': 'Tác giả / Nhiếp ảnh *',
            'contrib.authorPlaceholder': 'Nhiếp ảnh gia hoặc người sáng tạo nội dung',
            'contrib.categoryLabel': 'Danh mục *',
            'contrib.yearLabel': 'Năm *',
            'contrib.yearPlaceholder': '2026 hoặc 2026-03-01',
            'contrib.directorLabel': 'Đạo diễn',
            'contrib.roleLabel': 'Vai diễn *',
            'contrib.synopsisLabel': 'Tóm tắt *',
            'contrib.pickHint': 'Nhấn để chọn ảnh (có thể chọn nhiều), hoặc kéo thả tệp / thư mục vào đây',
            'contrib.thumbHelp': 'Nhấn vào ảnh để đặt làm bìa (poster với tác phẩm); ảnh được tải lên CDN và tự động chuyển sang webp.',
            'contrib.note': 'Bài gửi sẽ được duyệt thủ công trước khi đăng; hãy chắc chắn bạn có quyền chia sẻ ảnh. Nội dung sẽ vào hàng chờ duyệt, chưa hiển thị ngay. Chọn “Bổ sung” để thêm ảnh vào album / tác phẩm có sẵn: mở trang chi tiết và dán liên kết vào “ID mục tiêu”.',

            'contrib.titleLabel': 'Tiêu đề *',
            'contrib.required': 'Bắt buộc',
            'contrib.sourceOptional': 'Liên kết gốc (không bắt buộc)',
            'contrib.sourceRequired': 'Liên kết gốc *',
            'contrib.optional': 'Không bắt buộc',
            'contrib.imgAppend': 'Ảnh cần bổ sung * (tối đa 30, tự động nén sang webp)',
            'contrib.imgAlbum': 'Ảnh * (tối đa 30, tự động nén sang webp)',
            'contrib.imgWorks': 'Ảnh phim * (tối đa 30, ảnh đầu tiên làm poster, tự động nén sang webp)',
            'contrib.readFail': 'Không đọc được ảnh: ',
            'contrib.encodeFail': 'Mã hóa ảnh thất bại: ',
            'contrib.poster': 'Poster',
            'contrib.cover': 'Bìa',
            'contrib.remove': 'Xóa',
            'contrib.maxImages': 'Tối đa {n} ảnh',
            'contrib.uploading': 'Đang tải lên {n}%',
            'contrib.submit': 'GỬI BÀI',
            'contrib.needTargetId': 'Hãy nhập ID nội dung cần bổ sung (liên kết trang chi tiết hoặc a-xxxx / w-xxxx)',
            'contrib.needTitle': 'Hãy nhập tiêu đề',
            'contrib.needDate': 'Hãy chọn ngày đăng',
            'contrib.needAuthor': 'Hãy nhập tác giả / nhiếp ảnh',
            'contrib.needSource': 'Hãy nhập liên kết gốc (bắt đầu bằng http/https)',
            'contrib.needCategory': 'Hãy chọn danh mục',
            'contrib.needYear': 'Hãy nhập năm',
            'contrib.needRole': 'Hãy nhập vai diễn',
            'contrib.needSynopsis': 'Hãy nhập tóm tắt',
            'contrib.needImage': 'Hãy chọn ít nhất một ảnh',
            'contrib.submitted': 'Đã gửi — đăng sau khi duyệt',
            'contrib.networkError': 'Lỗi mạng hoặc hết thời gian, vui lòng thử lại',
            'contrib.serviceDown': 'Dịch vụ gửi bài tạm thời không khả dụng ({n}), vui lòng thử lại sau',
            'contrib.uploadFail': '❌ Tải lên thất bại: ',
        }
    };

    /* 语言标签（导航切换控件用） */
    const LOCALE_LABELS = { 'zh-CN': '中文', 'en': 'EN', 'vi': 'VI' };

    function normalize(loc) {
        const s = String(loc || '').trim();
        if (DICTS[s]) return s;
        const base = s.split('-')[0].toLowerCase();
        for (const k of Object.keys(DICTS)) {
            if (k.split('-')[0].toLowerCase() === base) return k;
        }
        return null;
    }

    function detectLocale() {
        let fromQuery = null;
        try { fromQuery = normalize(new URLSearchParams(window.location.search).get('lang')); } catch (e) { /* ignore */ }
        // URL 显式指定时持久化：站内后续跳转（如 /gallery.html?album=N）不再带 lang，也能延续语言
        if (fromQuery) {
            try { localStorage.setItem('site-lang', fromQuery); } catch (e) { /* 隐私模式 */ }
            return fromQuery;
        }
        let loc = null;
        try { loc = normalize(localStorage.getItem('site-lang')); } catch (e) { /* 隐私模式 */ }
        if (loc) return loc;
        loc = normalize(document.documentElement.getAttribute('lang'));
        return loc || DEFAULT_LOCALE;
    }

    const locale = detectLocale();
    const dict = DICTS[locale] || DICTS[DEFAULT_LOCALE];

    /** 取词：命中返回译文；未命中回退 fallback；再回退默认语言；最后返回 key。
     *  传入 vars 时对 {name} 占位符插值（与 tpl 等价）。 */
    function t(key, fallback, vars) {
        let out;
        if (key != null) {
            if (dict && dict[key] != null) out = dict[key];
            else {
                const d = DICTS[DEFAULT_LOCALE];
                if (d && d[key] != null) out = d[key];
            }
        }
        if (out == null) out = fallback == null ? String(key == null ? '' : key) : fallback;
        return vars ? String(out).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : out;
    }

    /** 插值：tpl(key, vars, fallback) —— 显式版本，语义更清晰 */
    function tpl(key, vars, fallback) {
        return t(key, fallback, vars);
    }

    /**
     * 内容字段多语言读取：优先 obj[field + '_i18n'][locale]，
     * 否则回退 obj[field]。zh-CN 下等价于直接取 obj[field]。
     */
    function pick(obj, field) {
        if (!obj) return '';
        if (locale !== DEFAULT_LOCALE) {
            const map = obj[field + '_i18n'];
            if (map && typeof map === 'object') {
                const exact = map[locale];
                const base = map[locale.split('-')[0]];
                const val = exact != null ? exact : base;
                if (val != null && String(val).trim()) return val;
            }
        }
        return obj[field] != null ? obj[field] : '';
    }

    /** 导航语言切换控件（作为 .nav__links 的最后一个 <li>） */
    function langSwitchHtml() {
        const codes = Object.keys(DICTS);
        if (codes.length < 2) return '';
        return `<li class="nav__lang">${codes.map(code =>
            `<button type="button" class="nav__lang-btn${code === locale ? ' is-active' : ''}" data-lang="${code}">${LOCALE_LABELS[code] || code}</button>`
        ).join('<span class="nav__lang-sep" aria-hidden="true">/</span>')}</li>`;
    }

    /** 切换语言：整页跳转（写入 localStorage + URL 参数），不做 DOM 热切换 */
    function setLocale(next) {
        const loc = normalize(next);
        if (!loc || loc === locale) return;
        try { localStorage.setItem('site-lang', loc); } catch (e) { /* 隐私模式 */ }
        let url;
        try {
            url = new URL(window.location.href);
            if (loc === DEFAULT_LOCALE) url.searchParams.delete('lang');
            else url.searchParams.set('lang', loc);
        } catch (e) {
            url = null;
        }
        window.location.assign(url ? url.toString() : window.location.href);
    }

    /** 在给定根节点上绑定语言切换按钮（innerHTML 重建后需重新调用） */
    function bindLangSwitch(root) {
        const box = root || document;
        Array.prototype.forEach.call(box.querySelectorAll('.nav__lang-btn'), btn => {
            if (btn.dataset.bound === '1') return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => setLocale(btn.dataset.lang));
        });
    }

    /** 静态 HTML 标记翻译：data-i18n / data-i18n-placeholder / data-i18n-aria / data-i18n-title */
    function applyDom(root) {
        const box = root || document;
        Array.prototype.forEach.call(box.querySelectorAll('[data-i18n]'), el => {
            const v = t(el.getAttribute('data-i18n'), el.textContent);
            if (v) el.textContent = v;
        });
        Array.prototype.forEach.call(box.querySelectorAll('[data-i18n-placeholder]'), el => {
            const v = t(el.getAttribute('data-i18n-placeholder'), el.getAttribute('placeholder'));
            if (v) el.setAttribute('placeholder', v);
        });
        Array.prototype.forEach.call(box.querySelectorAll('[data-i18n-aria]'), el => {
            const v = t(el.getAttribute('data-i18n-aria'), el.getAttribute('aria-label'));
            if (v) el.setAttribute('aria-label', v);
        });
        Array.prototype.forEach.call(box.querySelectorAll('[data-i18n-title]'), el => {
            const v = t(el.getAttribute('data-i18n-title'), el.getAttribute('title'));
            if (v) el.setAttribute('title', v);
        });
        Array.prototype.forEach.call(box.querySelectorAll('[data-i18n-alt]'), el => {
            const v = t(el.getAttribute('data-i18n-alt'), el.getAttribute('alt'));
            if (v) el.setAttribute('alt', v);
        });
    }

    // 尽早反映语言到 <html lang>（无 FOUC：本脚本同步加载）
    document.documentElement.setAttribute('lang', locale);

    function boot() {
        applyDom(document);
        bindLangSwitch(document);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    window.I18N = {
        locale,
        defaultLocale: DEFAULT_LOCALE,
        isDefault: locale === DEFAULT_LOCALE,
        t,
        tpl,
        pick,
        setLocale,
        langSwitchHtml,
        bindLangSwitch,
        applyDom,
        dicts: DICTS
    };
    // 便捷全局（渲染脚本高频使用）
    window.t = t;
})();
