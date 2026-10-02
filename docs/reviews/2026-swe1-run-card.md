# swe1 跑批命令卡（每夜逐字照抄）

- 前置：在 `exp/swe1` worktree 内跑（`/Users/acfufu/Codehub/lazyzcode-swe1`）；夜里不开其他 GLM 会话；机器插电不合盖（`caffeinate -is` 已含在命令里）。
- 窗口：23:00–09:00（UTC+8）；起批时刻最晚 23:30。
- 断点：中断/重启后**重发同一条命令**即可——ledger 已 done 的 trial 自动跳过。

> **模型轴钉扎（必须带）**：所有跑批命令统一加前缀 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$PWD/artifacts/ablation/swe1-pin-personal-opencode.json`——否则引擎缺省解析落 Commandcode（余额已枯竭，preflight 会拒）。该文件=宿主配置仅关 new-provider 的过滤副本（0600）。

## n0b 补跑批（3 发：A:x03 + B:x04/A:x04，credit 死亡补测）

```bash
cd /Users/acfufu/Codehub/lazyzcode-swe1 && ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$PWD/artifacts/ablation/swe1-pin-personal-opencode.json caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n0b --cells "$(cat artifacts/ablation/swe1-cells-n0b.txt)" --timeout-ms 2700000
```

## n0 校准夜（已完成 2026-10-03 06:15，6/8 有效）

```bash
cd /Users/acfufu/Codehub/lazyzcode-swe1 && ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$PWD/artifacts/ablation/swe1-pin-personal-opencode.json caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n0 --cells "$(cat artifacts/ablation/swe1-cells-n0.txt)" --timeout-ms 2700000
```

## n1–n3 主跑（各 7/7/6 pair，预估每夜 ~4.5h）

cells 文件在终冻结时生成（`swe1-cells-n1.txt` / `-n2` / `-n3`），命令同构：

```bash
cd /Users/acfufu/Codehub/lazyzcode-swe1 && ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$PWD/artifacts/ablation/swe1-pin-personal-opencode.json caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n1 --cells "$(cat artifacts/ablation/swe1-cells-n1.txt)" --timeout-ms 2700000
cd /Users/acfufu/Codehub/lazyzcode-swe1 && ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$PWD/artifacts/ablation/swe1-pin-personal-opencode.json caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n2 --cells "$(cat artifacts/ablation/swe1-cells-n2.txt)" --timeout-ms 2700000
cd /Users/acfufu/Codehub/lazyzcode-swe1 && ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$PWD/artifacts/ablation/swe1-pin-personal-opencode.json caffeinate -is node scripts/ablation/run-batch.mjs --batch swe1-n3 --cells "$(cat artifacts/ablation/swe1-cells-n3.txt)" --timeout-ms 2700000
```

## 晨起出数（可选自查；正式出数由实验会话跑）

```bash
cd /Users/acfufu/Codehub/lazyzcode-swe1 && node scripts/ablation/aggregate.mjs --batch swe1-n0
```

## 判读速记

- 起批输出 `stage=preflight ok=false` = GLM 端点不可达，整批零假跑（不烧积分）——查代理/节点后重发。
- 账本 `artifacts/ablation/swe1-nX/ledger.jsonl`：每 trial 一行；`claimMarker`/`falseClaimMarker` 即北极星判读字段。
- 08:50 若批未完：直接 Ctrl-C 或杀进程皆可，残 trial 下夜自动重跑（残目录自动 force）。
