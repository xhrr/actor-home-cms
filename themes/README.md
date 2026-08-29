# 主题系统

主题为 ZIP 压缩包，结构：

```
my-theme.zip
├── index.html
├── css/
│   └── style.css
└── theme.json
```

上传后可在管理后台激活。激活后主题文件会覆盖默认 `site/` 文件，并在导出时合并到 `dist/`。

默认主题为 `site/css/editorial.css`，即 Editorial 编辑杂志风。
