# ADR-0014: 0.0.9 失效 DAG 与红绿 manifest——中央账本、E-01 调和、fail-closed

日期：2026-09-17 · 状态：已接受（棒1 落地；棒2 增补节见文末） · 拍板：grilling 2026-09-16 六问（goal v009-roadmap-grill，§⑪ 记录；实现 goal v009-bat1-dag-kernel）

0.0.9 Evidence & Attestation 的地基是**中央失效 DAG**：依赖边落盘
`.lazyzcode/loop/dag.json`（跨 reset 常驻，照 metrics.json/snapshots 先例），
取证与评审时注册边（「取证即注册边」），变更时图上传播失效，可答「什么依赖
X」类查询、可表达非哈希边（时间窗/外部表面）。红绿双证据（0.0.6 起的文本纪律）
自此有了机器账本：**红绿 manifest** 作为首个边源——`lzy evidence red|waive-red`
命令族 + green 取证时自动镜像，节点 half ∈ red|green|waived。

**Why**：0.0.8 复合指纹把「证据绑树」做到了机器强制，但失效推理仍靠手画回边
——V2 复审抓到的「审环不重审」类回边记账失败是结构性缺口；GPT 蓝图 N1/N2
（红/绿证据结构化）与 N4（central invalidation）同指一处。三条件在案：
**难逆**（账本进入执法链后语义不可回退）；**无背景会费解**（为什么「看起来
做完了」还要问依赖什么）；**真取舍**（中央存储 vs hash 推导式——拍板中央存储：
hash 推导表达不了非哈希边，且 0.0.8 复合指纹视为其微缩先例）。

**E-01 调和（Q2）**：蓝图「RED 只绑 base」与现行合法 rebind 实践冲突——定案
**红绿各绑各面**：manifest 里 red/green 各带自己的表面（red 缺省=取证时点复合
指纹〔即 base 树〕，`--surface` 显式声明外部表面〔已发布版版本号等〕均合法）；
「未变表面重录=合法 rebind」保留，机器痕迹=新代次节点追加 `supersedes` 边、
同一 red 节点多条 `red_of` 边合法（最新为现行、全部留史）；「RED 只绑 base」
本意降为纪律句——**机器只记账不裁决**，红绿缺半不拦任何门（执法仍在协议文本
+comparator；comparator 的配对/在场核对读 `lzy evidence list` 为第一来源，
断言×证据的相关性裁决不变）。waive-red=一行豁免的机器形态（必填 --reason、
无表面节点）。

**fail-closed 语义（Q4，棒1 起机器强制）**：账本解析/校验和失败→一切读账本
命令拒绝并给恢复指路（绝不静默当空库）；取证注册走 **dag-first**（DAG 写失败
=整命令拒、goal.json 不动、重试安全；对齐既有部分失败家族语义）；统一权威
（verify/finish 有效性判定整体切图、hash 比对降为边型之一）归**棒2**——棒1
为纯加法，verifyEvidence/doFinishLoop 逐行未动；届时图不可读/不一致一律拒、
无逃生 flag（沿 ADR-0013 家法）；legacy 证据双轨回退行为与 0.0.8 全同。

**Consequences**：存储介质拍板 **JSON 原子写**（writeGoal 同款 tmp→rename+载荷
sha256 校验和）——node:sqlite 无旗标仅 22.13.0+/23.4.0+，engines `>=22` 下选它
等于暗中抬 floor 或做双写路径；sqlite 在本仓一律外物只读（ADR-0003）。多会话
交叉点（§⑪）：DAG 写全部嵌既有 withLock 临界段，不新增锁原语；锁内写拉长临界
段放大 §⑩-4 对端 5s 等锁窗——已入计划已知未知并带预注册阈值（万边级写 >1s
即触发棒2 前修「判定移出锁」）。孤儿 green（代数超前 goal.json）=dag-first
部分失败残留，视图如实标注不静默隐藏；红/waive 边只存在 DAG（丢失不可重算）
——恢复=人工抢救后删文件重建。权威切换（棒2）前账本不进任何门：本 ADR 承诺
的是账本存在与语义，非其执法时点。

## 增补节：棒2 统一权威切换语义（2026-09-17，goal v009-bat2-unified-authority 落地）

**代次锚定选择**：verifyEvidence/finish 的有效性判定读账本——每 F 步按
goal.json 当前代次（`evidenceSeq-1`，缺省 1）精确锚定绿节点（`seq` 相同多条按
`(seq, at)` 决胜，沿 findLatestGreen 家法），**非 latest-wins**。孤儿门语义
（棒2 输入 #1）：dag-first 半失败残留的更高代次 ghost 在锚定语义下**天然不可
现行、不阻断** attest/finish——它从不是判定入参；`lzy evidence list` 的 ⚠
标注兜底不变（如实展示不隐藏）。**账本-goal 分歧 fail-closed**：fingerprint
形态记录而无锚定节点（0.0.8 在途 goal 升级、或账本被改）→ verify/status/
finish 一律拒（「证据账本不一致+恢复指路」，无逃生 flag；恢复=重跑
`lzy step done <id> --evidence` rebind 即重注册节点）；treeHash 形态=legacy
双轨，0.0.8 行为逐字段同。账本不可读照棒1 语义拒（含 verify 无锁读面——原子
写保证读者见旧或新）。

**comparator attestation（§⑪ N3）**：`lzy attest comparator --file <json>`
把 qa-executor 对照结论入账（comparator 节点绑 slug+planHash+当刻复合指纹+
文件 sha256+逐项明细；`attests` 边→现行 plan 节点）。机器只记账不裁决照旧
——MISMATCH 也如实入账；裁决在 finish 机器门：**HEAVY 强制**现行记录（按
slug+planHash 取最新）且 MATCH 且指纹未过期，三者缺一即拒、无逃生 flag；
LIGHT 可 self-check 免录。重对照=新节点追加（最新为现行），指纹过期（对照后
代码又变）须重录。

**终验 attestation（§⑪ N5）**：finish 在 writeReport 成功后、writeGoal 置
done 前原子写 `.lazyzcode/attestations/<attemptId>.json`——LOOP_COMPLETE 的
机器证明：attemptId（=`<slug>-<finish 时刻 UTC 紧凑串>`，秒粒度，追加不覆
写）+slug/tier/lzyVersion+planHash+subjects 各根头树+复合指纹+每 F 项锚定
（generation/nodeId/surface）+comparator 记录（LIGHT=null）+report sha256+
finishedAt。写失败=LoopError、状态保持 executing（沿 0.0.8 原子收口家法）；
目录在 loop/ 之外=疤痕巡逻零接触、reset 不清（历史证明）。
