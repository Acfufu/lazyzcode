# ADR-0013: 0.0.8 完整性内核——finish 闸门、复合指纹、快照/tier 完整性面

日期：2026-09-16 · 状态：已接受 · 拍板：grilling 2026-09-16 深夜（goal v008-integrity-kernel，承接 GPT V3 反馈裁决 P0-A）

0.0.8 把「做完」从自觉升为机器强制：finish 增**完整性闸门**（{host}∪subjects
任一根 dirty/missing/git 报错即拒，**无任何绕过 flag**）；证据语义从单树
`HEAD^{tree}` 升为**复合指纹**（subject 集每根头树哈希按 realpath 排序串接的
sha256，任一根或集合本身变化即整体过期；legacy 证据回退单树比对、行为与 0.0.7
全同）；采纳即**快照计划绑 planHash**（review 同携哈希——评审绑被评审物；复采纳
换哈希而评审未重跑=红线，机器 warn 不拦）；**tier 落盘**（register `--tier` /
`lzy loop tier heavy` 单向）+ **HEAVY 机器门**（采纳时点无 PASS 一律拒，
`--force` 不越过）。

**Why**：GPT V3 反馈活体证实 dirty 假完成（脏树 verify 报新鲜 + finish
EXIT=0），根因=finish 无 dirty 闸门且证据只比单树（裁决底稿
artifacts/gpt-blueprint-triage-2026-09-16.md）。三条件在案：**难逆**（finish
语义变更是协议级承诺，发布后回退=承认假完成窗口）；**无背景会费解**（为什么
「看起来做完了」会被机器拒）；**真取舍**（无逃生门 vs 罕见正当脏树场景——拍板
选无逃生门，正当场景先 commit/stash 再 finish 是纪律而非障碍）。取代
ADR-0006:45 记名的多树绑定 deferred 备选（`--evidence-repo` 方案）——subject
集显式声明比按路径前缀推断更可控。`subject remove` 为评审 4 轮增补：append-only
集合在根永久消失时是死锁（missing 永拒且无出口），remove 是 abandon 外唯一出路，
收窄与从未声明同信任级（任何集合变化→指纹变→全体证据过期，不违「无逃生门」）。

**Consequences**：残余人权缺口三族记名——tier 由模型分诊自报（防遗忘漂移不防
恶意）且机器门=采纳时点（executing 态升级为程序性自报、不回溯评审，升级时
review 非 PASS 走 warn）；未声明兄弟仓对时效门不可见（声明纪律与 tier 自报
同族）；复采纳快照哈希变更而评审文本未换=红线（机器双臂 warn：--review 未带
或与存量 summary 逐字相同）。已知边界：闸门 git spawn 共享 8s 墙钟预算（<
LOCK_STALE_MS 60s 留余量〔ADJ-01 已抬高 stale 线，0.2.2 棒1#N9 随改〕）仍有单根超时×多根的残差、闸门检查与并发提交间的
TOCTOU 窗口（ms 级，结局=对较旧树 finish 而非伪造）、report tmp 落盘窗口的
kill -9 孤儿（history 按 `.report.md` 后缀过滤不受扰）、`VERDICT:` 标记形态是
机器门载荷（parseVerdict 无标记回退串可 spoof——评审协议要求标记形态）。

**后补记（2026-09-16，goal multisession-discipline）**：①计划已知未知 #3 结清——
「worktree 派工时 subject 指向 worktree 根即可（指纹按根隔离、共享对象库不串扰
脏态判定）」已由实测 + 契约用例（test/integrity-kernel.contract.test.js
`worktree-as-subject` 三断言：接受/脏态按根隔离/提交即指纹耦变）+ SKILL
Host workspace 句承载；未声明 worktree 仍在闸门视野外=声明纪律残差同族。
②dirty 拒的 detail：`git.integrity()` 的 dirty 态现带 `paths`（命中路径，排除
`.lazyzcode/`），finish 报文列前 3 条 + 超出计数（结清 GPT 蓝图 N1「报错列前 N 个
dirty paths」欠账）。
