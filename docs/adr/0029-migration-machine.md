# ADR-0029：完整迁移机器（0.3.0 M5）

日期：2026-09-26。状态：已接受（goal v030-m5-closeout 实施；设计总案 §8 的机器化落定）。

M1 只读预览（`lzy migrate preview`）之外补齐 §8 写路径，形态=`lzy migrate apply/status`（显式运行；update/sync 链永不自动迁移——升级触碰 `.lazyzcode/` 的红线维持）。核心拍板五条：

1. **版本入口=state.json，最后写=提交点**：`.lazyzcode/state.json`（schemaVersion+stateVersion+逐任务迁移记录）在备份/暂存/校验全部落地后才原子写（tmp+rename）；此前任何一步失败，树面无新状态可见。未知 schemaVersion/stateVersion 或 state 损坏=写前 fail-closed 停止，不覆盖源。
2. **四阶段+journal 相位记账**：backup（六记录族整树复制+manifest 逐文件 sha256 双读校验）→stage（在途→drafts 草案）→validate（manifest 重读核对）→switch；每相位追加 `migration/journal/<runId>.jsonl`。崩溃后重跑探测未收尾 run 并按任务身份（slug+planHash）幂等续跑——草案已写不覆盖、备份不重复、state 补齐即收束。
3. **执法分界（与 A2 对照声明同构）**：goal.json 损坏/未知版本=任何写入前停止；preserve 族（snapshots/salvage/approvals/attestations/evidence/plans）损坏=⚠记录并原样字节保留不阻断——与 M1 预览「执法面在闸不在读」同构：转换面 fail-closed，保留面本就承诺原样。
4. **在途判别=活体进程而非状态字段**：goal planning/executing 且无租约→可转换；有活跃租约且持有进程存活→拒（§8 活跃 lease 拒写）；租约在场但 holderPidAlive=ESRCH（僵尸）→在途可转换；runtime.json 不可读→按活体在场保守拒绝（同 holderPidAlive 不确定情形教义）。
5. **转换产物=契约草案而非可注册契约**：drafts/ 草案带 authorization=NONE+提权禁止四条+provenance，头键无 scope——`register --contract` 天然解析拒绝，转正必须人工另立契约+全新 UPS 批准；旧 planHash 批准零升级（ADR-0024 边界不松动）。

家族登记：`.lazyzcode/migration/`（backup/stage/journal）与 `.lazyzcode/drafts/` 按 core/loop.js 家族登记家法进 ANY_TMP_SCAN_DIRS（queue/budget/delivery 先例，观测面=清扫面同一判据），reset 不清。
