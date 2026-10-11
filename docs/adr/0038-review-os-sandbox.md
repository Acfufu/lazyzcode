# ADR-0038：独立评审补隔离卫生与 OS 强制边界（2026-10-11）

状态：用户确认，开发中；未发布。决策 #52。仅适用于 lzy 发起的独立评审及复核，不改变 drive/queue 默认执行方式。2026-10-11 增修订节（分级保证，用户拍板）。

## 背景与取舍

ADR-0031 的候选快照、独立 HOME、provider 允许表与转录检查能够减少污染，但父环境继承、绝对路径访问和任意网络连接仍可跨出隔离面。用户确认先补齐隔离卫生（A），再为独立评审建立 OS 强制边界（B）；暂不投入运行不可信代码的容器/VM（C）。评审读写需求较窄，先在该入口承担平台兼容与网络准入成本，不能把成功启动或事后转录检查当作 OS 隔离证明。

## 契约

- 启动环境使用白名单：HOME、XDG 与临时目录均落隔离面，不继承宿主 secret、NODE_OPTIONS、DYLD 或代理设置。PERSONAL 仍使用显式 provider 允许表；BUILTIN 模板也复制到隔离面，不直接读取用户配置目录。OAuth-only 认证仍不可用。
- macOS 使用 Seatbelt 包住整个评审引擎及其后代，候选与事实输入只读，隔离 HOME（包括 tmp）可写；允许引擎运行所需的系统/安装文件读取和全局路径元数据查询，不承诺隐藏文件存在性。后端缺席、平台不支持或探针失败都拒绝裸启动；Linux/Windows 暂无 B 后端。
- 来宾只能连接父进程的受控代理。准入 endpoint 来自已允许 PERSONAL 的 `api.baseUrl` 或其 BUILTIN 模板默认值；endpoint 无法解析或代理不可用即拒绝。普通 HTTP 转发精确核验 origin；HTTPS 仅准入配置的 hostname:port 对应 CONNECT。启动代理时固定 DNS 解析地址，本 run 不随请求重新解析；显式准入的本地/内网 API 仍可达。HTTPS 隧道不核验 TLS SNI、HTTP Host 或路径，因此不能宣称 HTTPS 精确 origin 隔离。已准入 API 凭据对来宾可读，该 endpoint 也允许传输评审内容，因此 B 不承诺阻止所有外泄。
- 来宾产物的转录发现、字节读取与 SQLite 用量查询也在同一 Seatbelt 边界内执行，父进程不直接跟随来宾链接。读取仅接受 regular 文件，拒绝符号链接、FIFO 与读取期间检测到的文件变化；转录读取上限 16 MiB。无法安全读取的用量保持 unknown，不能记为零。
- 正常结束、超时和可捕获中断回收同一 POSIX 进程组，并删除登记的凭据副本与 tmp。恶意 `setsid` 后代仍继承 OS 权限限制，但不能宣称全部回收。SIGKILL 无法即时清理：doctor 提示残留，`lzy review cleanup <runId>` 只回收已无活 owner 的登记配置副本和 tmp，保留会话转录与用量 DB。

## 边界与验收

本决策不建立容器/VM，不保证预算硬帽、评审正确性或其他同权限宿主进程无法篡改账本。既有候选身份、转录、用量与事后复核继续保留。验收须分别记录真实进程下的允许读取/写入/API 请求、拒绝越界文件与网络访问、子进程继承、环境污染排除、正常/中断清理及 SIGKILL 后恢复；未运行或未支持的平台不能计为通过。发布状态与实测结果另行记录，不由本 ADR 宣称。

## 修订节：分级保证（2026-10-11，用户拍板）

**触发**：原契约「OAuth-only 认证仍不可用」与「后端缺席拒启动」叠加后，`lzy review run` 仅在「macOS ∧ Seatbelt 探针通过 ∧ 个人 key 腿在场」单格形态可用。实际分发中仅 start-plan（OAuth 账号认证）是默认形态——统一门义务评审对多数用户物理不可达，goal loop 的 finish 面死锁；这是对 0.5.0 已可用行为（M3 三评审实证）的回归，且 doctor 对该形态无预诊断。

**拍板：B 后端＝增强，不是门槛。** 评审运行分两级，条件由机器钉死、无用户手选降级面：

- **os-sandbox tier**：Seatbelt 探针通过 ∧ 个人 key 腿在场（`prepareSandboxProviderConfig` 同判据：env 在场、可解析、过滤后非空）。本 ADR 上述契约全文适用。
- **app-layer tier**（任一条件不满足时自动降级）：0.5.0 应用层运行时——隔离 HOME＋envAuth＋facts-only＋读取轨迹与转录复核；不提供 OS 权限边界，威胁模型即 ADR-0031 第 9 行既有声明。运行档增 `isolation {level, backend}` 如实记档，doctor 对当前形态预诊断（不再到评审运行才炸）。

配置错误不降级：provider env 在场但不可读/过滤后零有效腿仍 fail-closed 拒（`provider-config-unreadable`/`no-sandbox-provider` 原判据不变）。「有 key 腿但无 OS 后端」（Linux/Windows）同样落 app-layer tier——后端缺席是平台事实而非用户选择，不再构成拒启动。app-layer tier 不冒充 OS 隔离：评审判决消费面（统一门回执、报告）读到 `isolation.level=app-layer` 时按 0.5.0 保证面口径引用。

### 二改：OAuth-only 完成面（2026-10-11 深夜，用户追问「OAuth-only 改动呢？」暴露的缺口）

一改的救济没有覆盖它自己的触发主体：app-layer tier 定义为「隔离 HOME＋envAuth」，而评审 preflight 的认证门（M2 N4#8）只认 provider env——**纯 OAuth（仅 start-plan、无可用 key 腿）机器在两个 tier 下都被 no-auth 拒**；且「配置在场但零有效腿」被一改钉成 fail-closed 拒，恰好命中默认形态（标准 provider 配置天然含禁用腿）。本机实弹（p0-ledger-fix 收口）撞线证实。

拍板三项：

1. **空交集≠配置损坏**：provider 配置可解析但零 enabled+key∩允许表 腿＝「无沙盒可用腿」的自然态，落 app-layer tier（不再 `no-sandbox-provider` 硬拒）；仅不可读/结构不可识别维持硬拒（`resolveSandboxProviderConfig` 返 null 语义）。
2. **app-layer tier 的 OAuth 凭据透传**：tier=app-layer ∧ 宿主 OAuth 凭据（`~/.zcode/v2/credentials.json`）在场 ∧ 无可用 provider 腿 → 复制凭据进隔离 HOME（0600，随 runDir 清理登记焚毁，doctor/residues 与 provider 副本同族点名）。**暴露中性论证**：app-layer 无 OS 边界，评审会话与宿主同 uid，本可直读宿主同权限文件——拒绝透传不减少任何暴露，只把整个默认用户群挡在门外；沙盒 tier 维持 provider-env-only（Seatbelt 内凭据复制=真暴露，`oauthFallback` 只认 app-layer）。运行档 `isolation.auth` 如实记 `oauth-copy|provider-env`。
3. **认证门语义**：`envAuth` 首判保持（既有夹具面不破）；`oauthFallback` 为增路非替代。auth 判定注入面修正：`deps.sandboxCapability` 为函数时须调用（一改实现漏调用致注入面全部意外走 app-layer——同批契约测试断言同侧未 exposing）。

诚实记录：一改提交信息「仅 start-plan OAuth 评审面恢复可达」系过度声明——一改只恢复了「配置在场但不可沙盒化」机器；本二改才完成触发主体（纯 OAuth）的救济。
