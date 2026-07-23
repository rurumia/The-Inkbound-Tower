# 墨缚之塔

《墨缚之塔》是一个无需构建步骤的浏览器卡牌与自动战斗原型。正式入口为 `index.html`，页面运行时还会加载 `src/` 中的模块和 `images/` 中的美术资源。

当前版本为 `v0.2.0`：正式战场使用 60U × 30U 连续坐标、1920 × 960 控制场和 terrain/Spine/overlay 三层画布。51 张卡牌与 3 个角色技能均有连续空间配置。

卡牌迁移以 `docs/三人卡组_连续墨迹规则_v0.2.0.txt` 为逐卡规则基准，战场底层约定以 `docs/墨缚之塔_v0.2.0_连续卷轴战场设计方案.txt` 为准。

## 本地运行

需要 Node.js 18 或更高版本。

```powershell
node tools/dev-server.mjs
```

浏览器访问 `http://127.0.0.1:4173/`。发布入口也支持直接通过 `file://` 打开 `index.html`，所有运行资源必须保持仓库内相对路径。

## 测试

```powershell
node --test tests/*.test.cjs
node tools/browser-smoke.mjs
```

浏览器巡检直接通过 `file://` 打开入口，不要求本地开发服务器。

## Spine 4.2 工具链

项目固定使用 Spine Editor 与 Spine WebGL Runtime `4.2.43`。默认自动查找项目同级的 `spine/Spine.com`，其他安装位置可通过 `SPINE_EDITOR` 指定。

```powershell
npm.cmd run spine:doctor
npm.cmd run spine:status
npm.cmd run spine:validate
```

`spine:doctor` 校验编辑器版本、官方 Runtime 版本、许可证文件和 Runtime SHA-256。`spine:validate` 要求每套导出资源都严格为 `4.2.43`。

33 个书灵玩法模板均映射到同名独立 Spine 包。资源位于 `assets/spine/<profile-id>/`，并由 `npm.cmd run spine:pack` 打包为可直接通过 `file://` 加载的 `dist/spine-assets.js`。

## 目录

- `index.html`：GitHub Pages 和本地运行入口。
- `src/`：应用、规则引擎、卡牌内容、UI 与样式模块。
- `images/`：角色、卡面及界面美术资源。
- `tests/`：规则与卡牌模块测试。
- `tools/`：本地服务器和浏览器巡检脚本。
- `vendor/spine/`：官方 Spine WebGL 4.2.43 浏览器 Runtime 与许可证。
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
