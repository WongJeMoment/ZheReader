# ZheReader

一处安静的阅读空间。用浏览器阅读自己的 PDF 和 EPUB，暖米白与鼠尾草绿的书架设计，支持桌面和手机。

**在线阅读：[wongjemoment.github.io/ZheReader](https://wongjemoment.github.io/ZheReader/)**

## 使用

1. 打开网站，点击「导入书籍」或拖拽 PDF / EPUB 文件到页面，可批量导入。
2. 点击书籍封面开始阅读，底部按钮或键盘左右键翻页。
3. 顶部可展开目录、添加书签、切换主题和全屏阅读；底部可以调整 EPUB 字号或 PDF 缩放，PDF 支持输入页码跳转及文字选择。
4. 返回书架后点击「继续阅读」，即可恢复阅读位置。也可以按 `/` 搜索书名或作者。
5. 首次使用可点击「探索阅读体验」，阅读本站原创示例《慢读时光》。

默认根据**设备本地时间**自动切换：

- **20:00（含）至次日 07:00（不含）**：静夜深色主题。
- **07:00（含）至 20:00（不含）**：暖纸浅色主题。

页面打开时也会检查时间并自动切换；支持手动固定浅色或深色。EPUB 正文随主题变化，PDF 深色模式会调整页面颜色（包含图片），需要查看原始色彩时可手动选择浅色。

## 数据与支持范围

书籍内容、进度、书签通过 IndexedDB 保存在**当前浏览器、当前网站地址**下，不上传书籍到服务器，不跨设备同步。请保留原始文件，清除网站数据、更换浏览器或使用隐私模式可能丢失书架。页面字体可从 Google Fonts 加载，加载失败会使用本机字体。

支持常规 PDF 与无 DRM 的 EPUB 2/3。加密 PDF 打开时会询问密码；EPUB 内脚本默认禁用。单个文件导入上限 250 MB，实际容量取决于设备内存与浏览器存储配额。PDF 扫描件可以阅读，但无法选择未经 OCR 的文字。建议使用较新版本的 Chrome、Edge、Firefox 或 Safari。

## 本地开发

需要 Node.js 22.13+（推荐最新 Node.js 22 LTS）。

```bash
npm ci
npm run dev
```

构建和本地预览：

```bash
npm run build
npm run preview
```

浏览器测试：

```bash
npx playwright install chromium
npm test
```

Playwright 覆盖定时主题、EPUB 导入与目录、书签、进度恢复、PDF 渲染与翻页、重复/无效文件处理和移动端布局。测试使用生成的 PDF 与本站原创 EPUB，不含用户书籍。

`python3 scripts/make_sample.py` 可重新生成示例 EPUB。

## 发布

推送至 `main` 会运行 `.github/workflows/deploy.yml`，构建后发布至 GitHub Pages。仓库 Settings → Pages 的 Source 应设为 **GitHub Actions**。Vite 使用相对资源路径，可部署到 `/ZheReader/` 或其他静态网站目录。

## 技术

Vite、原生 JavaScript、IndexedDB（idb）、[PDF.js](https://mozilla.github.io/pdf.js/)、[epub.js](https://github.com/futurepress/epub.js)、Lucide 图标与 Playwright。PDF worker、CMap、标准字体和 WASM 与网站一同部署，无须第三方 PDF 阅读服务。
