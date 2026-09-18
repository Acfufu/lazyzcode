# ADR-0019: 非 git 宿主政策——register 硬拒 + 读面警示 + 降级形态立项

日期：2026-09-19 ｜ 状态：已拍板（roadmap §⑬ Q5）｜ 关联：决策 #19（宿主工作区）、
ADR-0013（完整性内核）、§⑫ 债二（sess_2c289129 实测报障）

## 背景

宿主目录无 git 时循环前半程畅通（register/plan/start 均不探 git，`baseTreeHash=null`、
`dirty()` fail-open），到 finish 才三重撞墙且全档位无解：unbound 拒、完整性闸门 host 根
missing 拒（报错给的 `subject remove` 出口对宿主根本身不适用）、HEAVY 更早死于红半取证。
fail-closed 拒绝本身是设计立场（证据绑 git 树是产品根基，绝不静默放行）；缺的是
**前置条件前置**——不可达性被推迟到用户全量工作收口期才暴露（2026-09-17 实测形态）。

## 决策

四件，0.1.1 落地前三件：

1. **register 硬拒**（无逃生 flag，沿 0.0.8 P0-A 家法）：`registerGoal` 锁前探测
   `headTreeHash()`，返 null（目录非 git 仓或 git 不可用）即 LoopError，报文含恢复式
   指路（`git init` 并完成首次提交）与产品理由（证据绑定 git 树）。把不可达性从
   finish 期提前到注册期，零工作量损失时点最早。
2. **读面常驻警示**：doctor 新增 `host-git` 检查行（ok/warn-only，带 init 指路），
   覆盖存量 goal 与 git 中途消失形态；status 在 host 根 integrity=missing 分支追加
   同款指路句。
3. **文档前置句三处**：zw SKILL（Host workspace 段）、guide 双语（zw 协议节）、
   README 双语（Install 节）各补「宿主工作区须为 git 仓」前置条件句。
4. **非 git 降级形态立项（本 ADR 只立项，不实现）**：方向拍板记录——全 `--surface`
   外部面（证据绑外部表面而非树指纹）+ LIGHT-only（HEAVY 门面依赖树完整性，无解）+
   无 attestation（LOOP_COMPLETE 机器证明的语义根基是树快照，非 git 宿主给不出）。
   **LOOP_COMPLETE 语义重定义须实现期独立拍板**（是否允许「无机器证明的完成」存在），
   届时须预注册判据+对抗面复核（与 fail-closed 哲学的真实让步同权重）。立项前，
   register 硬拒即唯一立场。

## 依据

- warn+确认越过形态否决：确认疲劳下等于把发现点推回 finish 期，且「越过一次」的
  语义无法与「永久非 git」区分。
- 默认降级否决：静默改变证据语义违反 fail-closed 根基（0.0.8 P0-A 教训正形）。
- 探测点选 register 而非 plan/start：register 是零成本时点（用户尚未投入）；plan/
  start 已有「基线 tree 未知」弱信号但被实证忽视。

## 已知边界

git 中途被删/仓被损坏的存量 goal 由读面警示行兜底（register 门管不住已注册目标）；
`subjects` 声明面已有独立非 git 拒（`validateSubjectRoot`），不受本 ADR 影响。
