# 发布拾页 1.0.0

发布前保留全部功能修复，版本号在 manifest.json、package.json 和 CHANGELOG.md 中统一。

## 验证和打包

```bash
npm test
npm run check
npm run package
```

- `dist/shiye-web-notes-v1.0.0.zip`：源码和本地加载包，解压后进入包含 manifest.json 的目录。
- `dist/shiye-chrome-web-store-v1.0.0.zip`：商店上传包，ZIP 根目录直接包含 manifest.json，只包含运行资源与图标。
- `dist/SHA256SUMS.txt`：校验和。

浏览器流程检查见 README。发布包不要包含 .git、node_modules、test-results、备份文件、私人截图、环境凭据和本机账号数据。

## 开源发布

使用 MIT 许可证。在公开仓库发布源码、隐私政策、贡献指南、变更记录和演示截图。商店未通过审核前不要填写虚假的安装链接或“已上架”标识。GitHub Release 可附两个 ZIP 和校验和。

## Chrome 商店

1. 打开 [开发者后台](https://chrome.google.com/webstore/devconsole)。如未注册，账号所有者需亲自阅读协议并处理注册费。
2. 创建新条目，上传 `shiye-chrome-web-store-v1.0.0.zip`。
3. 按 [商店文案](STORE_LISTING.md) 填名称、说明、支持网址、类别与语言。
4. 提供128×128 PNG图标和至少一张截图。截图用1280×800或640×400，PNG为无Alpha或JPEG；可选小型宣传图440×280。上传前按 [官方图片要求](https://developer.chrome.com/docs/webstore/images) 核对。
5. 填单一用途、权限理由、远程代码和数据使用说明；公开提供 [隐私政策](../PRIVACY.md)，与实际实现和商店申报一致。
6. 核对发布者信息、联系邮箱、分发地区与受众、测试说明。此类账号和身份信息由账号所有者确认，不代填虚构信息。
7. 资料有效后“提交审核”。若勾选开发者协议、作出法律认证或产生费用，须账号所有者在该步骤亲自确认。上传、提交审核和审核后上架是不同状态。

当前准备资料不代表商店已经受理或批准。审核结果以开发者后台实际状态为准。

## 官方依据

- [首次发布](https://developer.chrome.com/docs/webstore/publish/)
- [注册开发者账号](https://developer.chrome.com/docs/webstore/register/)
- [图片要求](https://developer.chrome.com/docs/webstore/images)
- [隐私说明表单](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
