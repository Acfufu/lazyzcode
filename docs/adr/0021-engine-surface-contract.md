# ADR-0021: 引擎面契约——唯一边界归一与逐面契约测试

日期：2026-09-20 ｜ 状态：已拍板（grill-with-docs 九问，goal v021-engine-surface）｜
关联：ADR-0001（config 零写入：引擎调用只经官方 CLI）、ADR-0012（payload-ver 代际自查先例）、
ADR-0018 修正案（同批：人权门诊断边界）、决策 #16（经验测量）、§3 硬约束（引擎代际判别轴）

## 决策

**引擎面（engine surface）= lzy 消费引擎 CLI 输出的固定触点集合，共五处**：
`--version`、`plugins enable <id>`、`plugins uninstall <id> --force`、
`plugins list --json`、headless `--json` 摘要。五面即契约面：每面的形状/语义变化都
属于**代际漂移**（引擎换代时输出面变化而载荷未同步），须由契约测试拦截，不得只核版本锚。

1. **唯一边界归一**：引擎输出的形状差异只在 `core/engine.js` 内消化——`listJson()`
   经 `normalizePluginList(raw)` 归一后返回，调用方（`findInstalledPlugin`、
   `core/status.js`）**不感知代际**。跨代形状差异由此收敛到一个函数，而非散在各调用点。
2. **归一语义**：任何输入恒归一为 `{plugins:[…], diagnostics:[…]}`。数组→`plugins=raw`；
   不透明对象→`plugins=raw.plugins` 且**顶层未知键经 `...raw` 透传不丢**；其余（标量/
   null/undefined）→`plugins=[]`。每插件 `diagnostics` 展平并注入归属键
   （`d.plugin ?? d.pluginId ?? d.id ?? <宿主插件 id>`），使 status.js 既有谓词
   `d?.plugin === id` 无需改动即命中。**null 仅在 JSON.parse 失败时给出**。
3. **每面须契约测试**：五面各有 pin（`test/engine-surface.contract.test.js`，假引擎
   argv 分派 + env 注入载荷，同一构件扮两代）。尤其：两包封下的 `enabled` 行**逐字相同**
   （等价性钉）；headless `--json` 拒数组的既有防御**须钉死**，防日后「顺手放宽」。
4. **代际同步须核 JSON 面**：`§3 硬约束` 的代际复核不止版本锚——JSON 面同入核对清单。
   本次事故即「只核了版本锚未核此 JSON 面」（0.1.2 期 engine-3140-sync 锚 3.14.0 时
   已存在，未被发现）。

## 已知边界

1. **未知顶层键只透传不解释**（对象输入经 `...raw`）：旧代际若另有顶层键，lzy 原样
   带着它走而不理解其含义——这是「不吞掉」而非「已支持」。
2. **非对象 diagnostics 元素被丢弃**：`isPlainObject` 过滤在前（否则 `{...d}` 会把
   字符串展成字符表）。代价=引擎若把诊断放成字符串数组将静默丢失（当前两侧样本均
   为空数组，无实证形态）。
3. **联合去重口径**：去重键 `JSON.stringify([severity, code, message, plugin ?? ""])`
   含归属键，故「无归属顶层副本」与「有归属插件内副本」的同一诊断**不折叠**（键值不同）。
   跨归属折叠会误并两个不同插件的同文诊断，代价更大；旧形状是否产生此重叠无存档样本
   不可判，故取保守侧。
4. **fail-loud 边界（非逐字段等价）**：合法 JSON 的假值输出（`null`/`false`/`0`/`""`）
   由「`!list` → warn」变为「`{plugins:[]}` → fail」。方向为 fail-loud（更响而非更哑），
   且引擎实际不产出此类输出。**本 ADR 不宣称归一前后逐字段等价。**

## 依据

- 事故：引擎 0.16.9（ZCode 3.14.0 代）`plugins list --json` 改出**裸数组**，0.16.5 为
  对象包封 `{plugins:[…]}`；插件记录本身（`id`/`enabled`/`skillCount`/`commandRootCount`/
  `hookDetails`/`diagnostics`）跨代**字段名逐字相同**。`findInstalledPlugin` 只读
  `list.plugins`，于是 0.16.9 宿主上 `status`/`doctor` 的 `enabled` 行落 **fail 级误报**
  并翻退出码——用户看到的是「未安装」假故障。实况：本机 `lzy doctor`/`lzy status` 修复前
  **均 exit 1**（0.2.0 发布执行记录记为既有缺陷，非 0.2.0 回归）。
- 根因不是那一行 `Array.isArray`，而是**该面零测试覆盖**：`test/` 全域无任何测试触达
  `core/engine.js` 或 status/doctor 的 enabled 行。单点修一行，下个代际仍会静默漂移。
- 归一放边界而非调用点：调用点分支会把「引擎有几代包封」这一知识复制到每个消费方，
  下个面（或第三形态）出现时要改 N 处；边界归一后新增代际只动一个函数，且契约测试
  天然落在该函数上（对照 ADR-0012 的 payload-ver 三态自查：代际差异的可见化先例）。

## 备选与否决

- **改两处调用点（`findInstalledPlugin` + status.js 各自 `Array.isArray` 三元）**：
  diff 更小，但形状分支散在两眼，下个代际或第三个消费方出现时又得改多处，且没有
  一个自然的测试锚点。否决。
- **`listJson()` 保持原样、由调用方各自容错**：等于把「引擎面不可信」这一事实推给
  所有调用方，违背「边界处消化外部不可信输入」的通例。否决。
- **加 doctor 代际行主动探包封形态**：多一行诊断噪声，且 `doctor` 已报引擎版号；
  契约测试已提供更强的拦截（漂移即红），无需运行时探针。否决。
