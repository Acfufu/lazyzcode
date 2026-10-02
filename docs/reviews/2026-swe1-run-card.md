# swe1 跑批命令卡（每夜逐字照抄）

- 前置：在 `exp/swe1` worktree 内跑（`/Users/acfufu/Codehub/lazyzcode-swe1`）；夜里不开其他 GLM 会话；机器插电不合盖（`caffeinate -is` 已含在命令里）。
- 窗口：23:00–09:00（UTC+8）；起批时刻最晚 23:30。
- 断点：中断/重启后**重发同一条命令**即可——ledger 已 done 的 trial 自动跳过。

## n0 校准夜（4 题 × 双臂 = 8 trial，预估 ~3h）

```bash
cd /Users/acfufu/Codehub/lazyzcode-swe1 && caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n0 --cells "$(cat artifacts/ablation/swe1-cells-n0.txt)" --timeout-ms 2700000
```

## n1–n3 主跑（各 7/7/6 pair，预估每夜 ~4.5h）

cells 文件在终冻结时生成（`swe1-cells-n1.txt` / `-n2` / `-n3`），命令同构：

```bash
cd /Users/acfufu/Codehub/lazyzcode-swe1 && caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n1 --cells "$(cat artifacts/ablation/swe1-cells-n1.txt)" --timeout-ms 2700000
cd /Users/acfufu/Codehub/lazyzcode-swe1 && caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n2 --cells "$(cat artifacts/ablation/swe1-cells-n2.txt)" --timeout-ms 2700000
cd /Users/acfufu/Codehub/lazyzcode-swe1 && caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n3 --cells "$(cat artifacts/ablation/swe1-cells-n3.txt)" --timeout-ms 2700000
```

## 晨起出数（可选自查；正式出数由实验会话跑）

```bash
cd /Users/acfufu/Codehub/lazyzcode-swe1 && node scripts/ablation/aggregate.mjs --batch swe1-n0
```

## 判读速记

- 起批输出 `stage=preflight ok=false` = GLM 端点不可达，整批零假跑（不烧积分）——查代理/节点后重发。
- 账本 `artifacts/ablation/swe1-nX/ledger.jsonl`：每 trial 一行；`claimMarker`/`falseClaimMarker` 即北极星判读字段。
- 08:50 若批未完：直接 Ctrl-C 或杀进程皆可，残 trial 下夜自动重跑（残目录自动 force）。
