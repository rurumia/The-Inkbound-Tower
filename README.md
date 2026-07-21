# 墨缚之塔

《墨缚之塔》是一个无需构建步骤的浏览器卡牌与自动战斗原型。正式入口为 `index.html`，页面运行时还会加载 `src/` 中的模块和 `images/` 中的美术资源。

## 本地运行

需要 Node.js 18 或更高版本。

```powershell
node tools/dev-server.mjs
```

浏览器访问 `http://127.0.0.1:4173/`。不要只单独打开或上传 `index.html`，否则模块和图片路径会缺失。

## 测试

```powershell
node --test tests/*.test.cjs
node tools/browser-smoke.mjs
```

浏览器巡检要求本地开发服务器已在 `4173` 端口运行。

## 目录

- `index.html`：GitHub Pages 和本地运行入口。
- `src/`：应用、规则引擎、卡牌内容、UI 与样式模块。
- `images/`：角色、卡面及界面美术资源。
- `tests/`：规则与卡牌模块测试。
- `tools/`：本地服务器和浏览器巡检脚本。
- `docs/`：当前规则文档与卡组原始设计。
- `docs/archive/`：旧单页实现和历史构建方案，仅供参考。

## 发布

仓库连接 GitHub 后，正常更新流程为：

```powershell
git add -A
git commit -m "描述本次修改"
git push
```

Git 只提交发生变化的文件，不需要在 GitHub 网页上重复上传整个目录。
