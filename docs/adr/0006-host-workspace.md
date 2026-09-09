# ADR-0006 · 宿主工作区：跨仓目标循环的就地语义 + 写命令 fail-fast + 恢复式报错

日期：2026-09-09 · 状态：已拍板 · 关联：决策 #19（本决策）、#17 修订（认领写面收窄）、
ADR-0004（认领制）、ADR-0001（严格就地解析先例）

## 决策

多仓库目标的循环状态（`.lazyzcode/`）寄宿主仓，会话以**宿主工作区（host workspace）**
为根：`lzy` 只在宿主根跑，代码可在兄弟仓。目录解析维持**严格 cwd、不 walk-up**
（ADR-0001 同一立场）；跨仓 cwd 纪律由 zw 技能文本承载（Host workspace 条件小节）。
配套四条：

- **写命令 fail-fast**：`plan/start/step/finish/abandon` 五命令进 `withLock` 前先判空
  即抛——withLock 的 `mkdirSync` 会在无 goal 的目录留下 `.lazyzcode/loop/` 空壳疤痕
  （zpigeon-phase2 事故的疤痕形态）；`reset` 显式豁免（null-goal 残留清理语义是
  p3-sweep 契约）。
- **恢复式报错**：全部「无 goal」出口（status 读面 + 写命令 + verify/export）共用同一
  文案源——报实际检查的绝对路径 + 恢复指引（回注册目标的工作区根；多仓目标回宿主根）。
  走错目录的人需要知道「查了哪、该回哪」，不是一句「没有目标」。
- **触发分级认领**（ADR-0004 修正案）：UPS 认领写面从「全谱触发词命中」收窄为
  **唤起级**——句首 zw / 显式 `lazyzcode:zw` / 句首 ulw·ultrawork 才写 `claimedAt`；
  通知注入维持全谱分层不变（R4-4 同线延伸）。specimen：另一会话正文「对比 /ulw 的
  写法」被全谱匹配误认领，Stop 拉回致盲真主会话。
- **doctor 疤痕巡逻**：状态卫生检查增「`.lazyzcode/loop/` 在场但无 goal.json」warn 行
  （指引手动 `rm -r`——reset 对 null-goal 空壳报「无需 reset」清不掉目录本身），
  warn-only 不翻退出码。

## 依据

- 事故驱动（2026-09-09）：zpigeon-phase2 会话在兄弟仓目录跑 `lzy step`，跨仓 Bash cwd
  漂移让写命令落在错误目录——报错不指路，还留了空壳目录；同日 /ulw 提及误认领。三处
  疤痕（zpigeon、zpigeon-ios、betterzcode/app）均为本缺陷活体证据。
- walk-up 否决证据链：cargo #7871/#7621 的 walk-up 事故体系（错误配置静默上溯）；上游
  omo「配置 walkup、状态就地」的自觉不对称；本机已存在嵌套 `.lazyzcode`（zcode/
  svg-recreation、betterzcode/app），walk-up 会让内外两层状态静默互串。
- 证据时效洞如实记账：宿主模式下时效门只见宿主树——兄弟仓改动不触发过期、宿主记账
  提交可能误拦。本期只做可见化（技能文本纪律：F 项在最后一次代码仓提交后取证，finish
  前兄弟仓有新提交则重验重录）。

## 备选与否决

- **walk-up 目录解析**：见上证据链，否。
- **`-C/--cwd` 旗标**：上游 lazycodex/OmO 均无此面；`cd <宿主根> &&` 惯用法已覆盖，
  独立旗标是命令面膨胀，记备选。
- **多树绑定 `--evidence-repo`**：证据 tree hash 扩展为多仓绑定，等真实误 finish 事故
  再做（升格条件：下次因跨仓改动漏判导致误 finish），记名债务。
- **会话独占认领**（顺带复核）：引擎无 SessionEnd（§3.1），独占残留会死锁——维持
  ADR-0004 集合语义，修正案只收窄写面不收窄集合。
