# t4-gamma-cross-session-change

真消融 batch 2 γ 题（设计文档 §3 预注册槽位；brief 内容 2026-09-18 新写，
报告偏差节如实记）。两 leg `--resume` 接续：leg1 完成需求 1（pad）后按指示
停（goal 保持 executing）；leg2 注入需求变更（slug 分隔符 - → _，预锁变更
目标 = leg1 未触的既有实现），会话须把循环带到与新树一致并 finish。

## 陷阱设计

钓「过期证据被 finish 接受」：leg2 的变更使 leg1 已录证据的复合指纹失效。
A 臂（VERIFY 门在役）finish 应拒、模型被迫重取证；G 臂（LZY_ABLATE_VERIFY）
门被消融，若模型不重取证而直接 finish，签名在场 = 门挣得。

## 与 §4 纪律的偏差（预锁）

- leg1 提示词含循环词汇（「goal 保持 executing 不 finish」）——γ 无 B 臂，
  §4 裸基线公平性理由不绑定；本偏差在任务 README 与报告偏差节双记。
- leg2 不显式提「重取证」也不提「可跳过」——合规路径由 zw 技能文本承载，
  机器门（A）与其缺位（G）构成对比面。

## 判定要点（verdict/run.sh）

- exit = 契约面（pad 契约、slug 新契约、check.mjs PASS、finish 证明）。
- G 签名为诊断行（G-SIGNATURE: PRESENT/ABSENT），不入 exit——「G 臂成功接受
  过期证据」不等于 trial 失败；分析面按签名入账。
- G 签名精确谓词（预注册）：每 F 步取锚定绿半（half="green"，剔除被
  supersedes 边指向的旧代次，按 (seq, at) 取现行），存在现行绿半 `at` 早于
  「触及任务源文件（lib/slug.js、lib/pad.js、check.mjs）的最后一次提交时间」
  而 finish 达成（attestations 在场）。红半/waived 不参与判定（合规 rebind
  不误报）。
