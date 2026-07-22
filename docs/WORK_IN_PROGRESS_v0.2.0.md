# v0.2.0 续作检查点

更新时间：2026-07-22

## 分支安全

- `main` 与标签 `v0.1.0` 保持原版，未被修改。
- 当前开发分支：`v0.2.0`。
- 第一版重写备份：`archive/v0.2.0-first-rewrite`，提交 `a91233f`。
- 回到原版：`git switch main`。
- 回到新版：`git switch v0.2.0`。

## 已完成

- `e87be39`：从 v0.1.0 建立连续坐标、形状、控制场、区域、碰撞、导航和确定性笔刷。
- `14339a7`：连续战场组合状态、六个初始书灵、三口墨井、浸润和行动播放契约。
- `a55a5ca`：连续前线 AI、镜头、33 套 Spine 视觉契约及资源验证/打包器。
- `tools/browser-smoke.mjs` 已改为真正通过 `file://` 打开 `index.html`。
- 当前 40 项自动测试通过，v0.1.0 生产入口的浏览器冒烟通过且无运行时错误。

## 当前边界

- `index.html` 仍运行完整稳定的 v0.1.0 战斗，尚未切换半成品连续战场。
- 新代码位于 `src/battlefield/` 与 `src/presentation/`，目前通过测试独立运行。
- 不得复制或参考备份分支中的 `src/v2` 实现。
- 设计基线为 `docs/墨缚之塔_v0.2.0_连续卷轴战场设计方案.txt`。

## Spine 阻塞项

- 目标版本：Spine 4.2.x，编辑器导出版本必须与官方 Runtime 匹配。
- 需要确认 Spine Editor/Runtime 发布许可。
- `npm run spine:status` 当前应报告 `0/33` 套资源完成。
- 现有卡图单格约 160 x 96，只可作为造型参考，不能直接作为正式骨骼贴图。
- 当前环境没有内置图像生成工具。若使用图像生成 CLI，需要用户在本地配置 `OPENAI_API_KEY` 并明确允许 CLI 路径；不要在聊天或仓库中保存密钥。

## 下次继续顺序

1. 运行 `git status --short --branch`，确认处于 `v0.2.0` 且工作树干净。
2. 运行 `npm.cmd test` 和 `npm.cmd run smoke`，确认检查点仍通过。
3. 确认 Spine 4.2 许可、Runtime 来源和透明角色素材生成方式。
4. 先完成三个初始书灵的独立 Spine 资源，运行 `npm.cmd run spine:validate`。
5. 接入 terrain/spine/overlay 三层渲染和 ActionSequencer，验证连续移动及同步落墨。
6. 通过门禁后再将三个初始书灵接入生产战斗，随后按茜娜、菲涅、20735 的顺序迁移卡牌。

## 验证命令

```powershell
npm.cmd test
npm.cmd run smoke
npm.cmd run spine:status
```
