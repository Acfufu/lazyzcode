# 无人值守回执配方（IM webhook 推送）

> 无人值守夜间推进目标后，战报只躺在本机。这份配方教你把结果推到**你自己的**
> IM 群机器人，早上手机上直接看。与[复挂配方](reports/plan-v2-workflow-cost-review.md)（plan-v2 报告 §6）配套：先复挂、再挂回执。

**零服务端立场**：`lzy` 本身不发起任何网络请求、不内置任何通知通道（宪法 ADR-0003/决策 #9）。
下面所有动作都是**你的**自动化脚本向**你自己的**机器人 webhook 发消息——中间没有
lazyzcode 的服务器，也没有任何遥测。

## 数据面：两条只读命令

- `node <lazyzcode>/cli/lzy.js loop status` —— 目标进度一行摘要（文本输出，适合直接推送）；
- `lzy loop export` —— 重导出完整证据包到 `.lazyzcode/evidence/<slug>.report.md`，
  想看细节时把关键行粘进消息即可（CLI 无 `--json`，别找开关）。

## 推送面：三例 curl（任选其一）

通用骨架（放在你的唤起自动化末尾，或单独一条「早晨 8 点」自动化）：

```bash
cd /path/to/your/repo   # 循环状态所在的工作区根
SUMMARY=$(node /path/to/lazyzcode/cli/lzy.js loop status 2>&1 | head -4)
```

**飞书自定义机器人**（群设置 → 群机器人 → 自定义机器人，拿 webhook token）：

```bash
curl -sS -X POST -H 'Content-Type: application/json' \
  -d "$(printf '{"msg_type":"text","content":{"text":"lzy 战报\n%s"}}' "$SUMMARY")" \
  https://open.feishu.cn/open-apis/bot/v2/hook/<你的token>
```

**企业微信群机器人**（群右键 → 添加群机器人）：

```bash
curl -sS -X POST -H 'Content-Type: application/json' \
  -d "$(printf '{"msgtype":"text","text":{"content":"lzy 战报\n%s"}}' "$SUMMARY")" \
  https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<你的key>
```

**Telegram Bot**（@BotFather 建 bot，拿到 token 与 chat_id）：

```bash
curl -sS "https://api.telegram.org/bot<你的token>/sendMessage" \
  --data-urlencode "chat_id=<你的chat_id>" \
  --data-urlencode "text=lzy 战报
$SUMMARY"
```

## 注意

- webhook token 是群门的钥匙：只放你自己的自动化配置里，不进仓库、不进截图。
- 渠道是平台政策敏感面（非官方接口随时可变），推送失败不影响目标循环本身——
  战报永远是 `.lazyzcode/` 盘上状态，IM 只是镜子。
- 目标完成后记得停用对应的唤起自动化（App 界面；`lzy loop finish` 会打印提醒行），
  空槽唤起是纯空转（ADR-0010：挂载=开、清空=关）。
