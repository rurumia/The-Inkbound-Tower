# v0.2.0 发布检查点

更新时间：2026-07-23

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
- 连续战场表现层已增加 terrain/spine/overlay 三画布统一尺寸、DPR、Camera2D 和 WebGL viewport 管理。
- ActionSequencer 已支持行动排队、初始帧定位和按路径进度逐步揭示 PaintOperation。
- Spine 4.2.43 Professional CLI 已验证；官方 `spine-webgl 4.2.43`、许可证和 SHA-256 门禁已固定到 `vendor/spine/`。
- `GameSpineRuntimeAdapter` 已支持从内嵌 `spine-assets.js` 构造纹理、atlas、骨骼、动画混合和 Spine 事件，不依赖 fetch/CDN。
- `tools/browser-smoke.mjs` 已改为真正通过 `file://` 打开 `index.html`。
- 正式入口已切换到连续卷轴表现层；1920 × 960 高精度控制场成为 HUD、占领面积和胜负的数据源，底图内部渲染提升至 960 × 480。
- 书灵行动的规则结算仍沿用原逻辑节点，表现路径改为柔弧、S 形扫笔和自然流线；移动全程只播放一次循环动画，笔刷角度连续跟随曲线法线。
- 51 张卡牌、3 个角色技能和 33 个笔刷配置均有连续空间契约；90 次交替行动确定性回归通过。
- 当前 74 项自动测试通过，33 套 Spine 资源校验和 `file://` 浏览器冒烟通过且无运行时错误。

## 发布边界

- `index.html` 已使用 terrain/spine/overlay 三层同步画布，并保留 v0.1.0 的回合、卡牌、构筑、AI 与 UI 行为。
- 旧格对象只作为现有卡牌效果的兼容索引；显示、面积统计、归档坐标与胜负均使用连续世界数据。
- 不得复制或参考备份分支中的 `src/v2` 实现。
- 设计基线为 `docs/墨缚之塔_v0.2.0_连续卷轴战场设计方案.txt`。

## Spine 当前状态

- 工具链固定为 Spine Editor 4.2.43 Professional 与官方 Spine WebGL Runtime 4.2.43；`npm.cmd run spine:doctor` 已通过。
- Runtime 许可证已随 `vendor/spine/LICENSE` 保存；正式发布仍需遵守其中关于有效 Spine Editor 许可和再分发的条款。
- `npm run spine:status` 当前报告 `33/33` 个玩法模板可用。
- 33 个玩法模板均已切换到同名独立 Spine 资源，基础动作、专属动作和五个表现层锚点通过资源门禁。
- 后续可以直接覆盖 `assets/spine/<profile-id>/` 下的同名导出文件，再重新验证和打包，无需修改规则代码。

## 后续替换顺序

1. 在 Spine 4.2.43 中调整工程并覆盖对应模板的同名导出资源。
2. 运行 `npm.cmd run spine:validate` 与 `npm.cmd run spine:pack`。
3. 运行 `npm.cmd test` 和 `npm.cmd run smoke`，确认正式战场 WebGL 像素门禁仍通过。

## 验证命令

```powershell
npm.cmd test
npm.cmd run smoke
npm.cmd run spine:doctor
npm.cmd run spine:status
```

## 2026-07-23 更新

- 完成大范围连续空间效果性能优化：矩形/圆形区域直接生成栅格行区间，结晶与禁法区域使用缓存和批量遮罩裁剪；20735「区域净化协议」压力场景实测约 12ms。
- 完成连续战场交互补全：战场左上角显示鼠标世界坐标，精度 0.1U；书灵、墨井和敌方召唤意图支持战场悬浮卡及动态数值变化。
- 修正召唤规则：所有结晶区域可作为召唤目标，禁法区仍禁止召唤；敌方召唤意图始终限制在敌方半场并在目标失效时重选。
- 完成卷轴背景、透视投影、圆形效果预览、墨井状态、结算界面缩放及 Spine billboard 的连续战场适配。
- `npm.cmd test` 74/74 通过；`npm.cmd run smoke` 通过，包含坐标显示、墙内召唤和净化性能回归。
