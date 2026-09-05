# 提示音试听与响度优化 设计

**背景**：设置页提示音「试听」按钮播放的是已保存的音量（`playDogearSound` 内部从 settings store 读取），滑块调完不保存试听不生效；且合成音为纯正弦波、增益封顶 1.0、音符短促，100% 音量下感知响度仍然很小。

**目标**：
1. 试听立即跟随当前滑块音量，无需先保存
2. 明显提升响度：100% 时感知约为现状 3~4 倍，且不破音

**架构**：
- 试听修复：`playDogearSound` 的 options 增加 `volume?: number` 覆盖参数（优先于 store 值）；设置页试听按钮传 `local.ui?.sound?.volume`。排除「保存后自动同步」方案——改变 store 语义会影响 dirty 判断。
- 响度提升组合（均在 100% 不破音前提下）：
  - 每个音符由单个 sine 振荡器改为**基频 + 2 倍泛音（40% 电平）** 两个振荡器共享同一 envelope，声音更饱满
  - 主增益映射 `volume × 2.5`（原封顶 1.0，现 100% → 2.5x）
  - 音符链后接 **DynamicsCompressor** 限幅（threshold -12dB / ratio 10 / attack 2ms / release 120ms），防止增益放大导致削波爆音
  - attack 由 15ms 缩至 5ms，短音更"实"；release 保持 15ms
- 每音符独立 gain envelope + 振荡器对（原实现是单振荡器切频贯穿全曲），生命周期随音符走

**模块边界**：
- `lib/dogear-sound.ts` — `playDogearSound` 签名与合成逻辑
- `app/settings/page.tsx:454` — 试听按钮传 volume 覆盖参数

**数据流**：设置页滑块改 `local` → 试听按钮将 `local.ui.sound.volume` 作为 `options.volume` 传入 → `playDogearSound` 优先使用覆盖值（其余调用点不传，行为不变，仍读 store）。

**错误处理 / 边界情况**：
- `options.volume` 与 store 值一样 clamp 到 [0,1]；volume ≤ 0 直接 return（避免占用防抖时间戳播静音）
- envelope 时间倒序检查：noteLength 最小 0.11s，release 起点 0.095s > attack 终点 0.005s，安全
- AudioContext 恢复失败仍静默（保持现状）

**未决问题**：无。100% 增益 2.5x 已拍板。
