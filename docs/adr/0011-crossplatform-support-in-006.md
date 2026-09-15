# ADR-0011: 0.0.6 直接支持三平台分发（修订拍板①「侦察不承诺支持」）

日期：2026-09-15 ｜ 状态：已拍板 ｜ 关联：ADR-0001（安装器路线不变）、artifacts/gap-roadmap §⑦ 第 9 项（原拍板①载体）、`docs/research-crossplatform.md`（事实底座）、`docs/design-crossplatform.md`（全安装链设计稿）

## 背景

§⑦ 第 9 项原拍板（2026-09-15 早）：跨平台只做只读侦察，不承诺支持，落地与否候选 0.0.7+——前提是「Windows/Linux 无本机探查途径，证据只能官方下载面推演」。当日 grilling 中业主两个新事实推翻该前提：①业主已建好三平台 Parallels 测试机（Windows 11 ARM64 / Ubuntu ARM ×2，`prlctl exec` 通道实证可用）；②业主明确目标前提改为「0.0.6 就支持 3 平台分发」。侦察同步证实前提可行性：官方下载面三平台×双架构全在（3.11.2），引擎钩子 schema 虽无平台字段但 `shell` 三态解析 + `process` 直启原语 + cmd PATHEXT 解析（VM 探针实证）给出一行清单跨双平台的启动器形态（设计稿方案 C′），lzy 安装链其余部分本就跨平台安全（`engine.js` execPath+shell:false、installer 纯 fs，底稿 §4）。

## 决策

1. **0.0.6 支持 macOS/Windows/Linux 三平台分发**，实现棒（crossplatform-support，另立 goal）按设计稿 §4 切分执行；拍板①自此作废，§⑦ 第 9 项改写为支持项、顺序重排为 recon→support→3+4→5→6→7。
2. **验收线=三 VM 实证 + CI matrix 全硬**：三平台安装→钩子真实触发→`lzy loop` 全链活体（Windows 落位实测补底稿空格）；CI 增 windows-latest/ubuntu-latest 腿，开腿前先治 node --test 的 Windows glob 语义与路径分隔符断言雷。
3. **实证边界=arm64 如实声明**：三 VM 均为 arm64 客户机（对齐官方一等象限，下载面三平台皆有 arm64 发行包）；x64 只做文档声明不实机验收，实测与否留后续拍板。
4. **doctor platform 行随实现升级**（原「立场不动」条款作废）：平台感知报告候选命中态，设计稿 §3。
5. 本 ADR 只记拍板与边界；技术方案以设计稿为准，实现拍板若推翻其推荐以新 ADR 为准。

## 依据

- **无证据前提已消解**：原拍板①的保守性建立在「不能实证 Windows/Linux」上；三 VM 就绪后继续只侦察反而留下「有测试机不测」的空转。
- **成本可控**：侦察实证断链恰三处（引擎候选表=纯数据表、钩子启动器=C′ 对偶孪生、CI 腿=机械件），lzy 核心链路零改动；详细成本分层在设计稿各表。
- **风险对冲**：cmd 引号边角、npm pack exec 位、Windows 桌面端落位三处未决面全部钉在实现棒验收映射里，验收线不因本 ADR 降低。
