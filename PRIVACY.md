# 拾页隐私政策 / Shiye Privacy Policy

适用版本：1.0.0 · 更新日期：2026-11-03

## 中文

拾页是一个在浏览器本机运行的网页高亮、笔记和截图标记扩展。当前版本没有开发者运营的服务器、账号系统、遥测、广告或云同步。开发者不会通过扩展接收、出售或分享你的网页内容和笔记。

### 在本机处理哪些信息

为完成你使用的功能，扩展会在本机处理：

- 保存记录的网页标题、完整 URL（包括查询参数和片段）或本地 HTML 文件路径。
- 你选中的原文、相邻上下文、文本偏移、页面滚动位置、颜色、笔记正文、创建及修改时间和记录 ID。
- 你主动截取的当前标签页可见区域图片、标记后的图片，以及截图来源、位置和尺寸。
- 你主动选择导入的 JSON 备份，以及你主动导出的 JSON、Markdown 或图片文件。

扩展会读取当前页面文本以定位选区和恢复已有高亮；它不会把整篇文章上传或自动保存为完整网页副本。文字定位会跳过输入框、文本域、可编辑区域等节点。截图包含画面里可见的内容，因此也可能包含私人信息。

扩展不建立你访问过的全部网页的浏览历史数据库，也不读取浏览器历史记录数据库。被保存记录中的来源 URL 和位置属于笔记的一部分。

### 保存位置与保留时间

笔记和已保存截图放在扩展的 `chrome.storage.local` 中，保留至你删除记录、清除扩展数据或卸载扩展。数据没有由拾页额外加密；对本机浏览器配置具有访问权限的人可能访问这些数据。

截图临时原图优先使用 `chrome.storage.session`，空间不足时回退到本地存储。下一次发起截图时，会清理超过 24 小时的临时截图；这不是精确到点的定时删除。会话存储中的内容也受浏览器会话生命周期管理。用于原文跳转的临时记录在使用后或关闭标签页时清理。导入备份的本地暂存项在正常完成或失败后清理。

尚未保存的截图绘图和笔记主要保留在编辑页内存中；关闭或刷新时可能丢失。当前版本没有自动草稿恢复。

### 网络与第三方

拾页没有向开发者发送笔记、截图、浏览统计或错误日志的接口，不加载远程脚本和第三方分析服务。网站图标通过浏览器提供的内部 `/_favicon/` 资源读取，不使用第三方图标代理。浏览器如何维护图标缓存和其他网络行为，受浏览器自身实现和隐私设置管理。

当你点击原文链接、项目链接或支持入口时，浏览器会打开相应网站；这些网站适用各自的隐私政策。向项目 Issues 主动提交的信息也受代码托管平台的政策管理。请勿在公开反馈中提交含有隐私的备份、截图或文件路径。

### 你的选择

- 在笔记库编辑或删除记录；卸载前可先导出 JSON 备份。
- 使用浏览器扩展设置限制网站访问，或关闭本地文件网址访问。
- 自行决定是否导入、导出和分享文件。导出内容未加密，可能包含完整 URL、内部网站地址、本机路径、摘录和截图。
- 删除扩展内记录不会删除已经导出的文件；需要自行管理这些副本。

如有隐私问题，请通过[拾页项目 Issues](https://github.com/blacker521/shiye-web-notes/issues)联系维护者。涉及私人信息时，请先描述问题类型，不要直接附上原始数据。政策变更会随项目文档更新。

## English

Version: 1.0.0 · Last updated: 2026-11-03

Shiye is a browser extension for local web highlighting, notes and annotated screenshots. This version has no developer-operated server, account system, telemetry, advertising or cloud synchronization. The developer does not receive, sell or share your page content or notes through the extension.

### Local processing

The extension locally processes the information needed for the features you use: saved page titles and complete URLs or local HTML paths; selected text and surrounding context; text offsets and scroll positions; note text, colors, IDs and timestamps; screenshots you request, annotations, image dimensions and source information; and backup files you choose to import or export.

Page text is read to locate selections and restore saved highlights. Entire articles are not uploaded or automatically stored as complete page copies. Text anchoring skips inputs, textareas and editable nodes. A requested screenshot may contain any private information visible in the captured area. The extension does not build a history of every website you visit or read the browser's history database; source URLs are part of saved notes.

### Storage and retention

Saved notes and images remain in the extension's `chrome.storage.local` until you delete them, clear extension data or uninstall the extension. Shiye does not add encryption to this storage. Someone with access to your browser profile may be able to access it.

Temporary original screenshots use `chrome.storage.session`, with a local-storage fallback when needed. Screenshots older than 24 hours are cleaned up when you start another capture, rather than by an exact scheduled deadline. Browser session lifetime also governs session storage. Temporary navigation records are removed after use or when the tab closes. Import staging data is removed after normal completion or failure. Unsaved editor changes mainly live in page memory and may be lost on reload or close.

### Network and third parties

There is no endpoint for sending the developer notes, screenshots, browsing statistics or error logs. The extension loads no remote executable code or third-party analytics. Website icons use the browser's internal `/_favicon/` resource, without a third-party icon proxy. The browser's own caching and network behavior remains governed by its implementation and privacy settings.

Opening a source, project or support link visits that destination under its own privacy policy. Information you choose to submit to repository Issues is governed by the hosting platform. Do not publish private backups, screenshots or file paths in public reports.

### Your controls

You can edit or delete notes, export a JSON backup, restrict website access and disable local file access in browser extension settings. Exported files are not encrypted and may contain full URLs, internal addresses, local paths, quoted text and screenshots. Deleting an extension record does not delete exported copies. You control the files you import, export and share.

For privacy questions, contact the maintainer through [Shiye repository Issues](https://github.com/blacker521/shiye-web-notes/issues). Describe the issue first without attaching private source data. Changes to this policy will be published with the project documentation.
