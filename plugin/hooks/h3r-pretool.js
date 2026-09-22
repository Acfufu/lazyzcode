#!/usr/bin/env node
// PreToolUse 命令层 H3R 门原型（0.2.3 goal v023-h3r-enforcement#N3；ADR-0022 增补节）。
//
// 车道边界=**仅无人值守段**：唤醒开关 `LZY_ABLATE_H3R_PRETOOL` 恰 "1"（反向语义，同家族
// 的 H3R_GATE）**且** drive 注入的身份段标 `LZY_SEGMENT_ID` 在场才判——交互会话即使拿到
// 开关也拿不到段标，天然免门（交互会话就是恢复路径）。开关的反向语义 + 「PRETOOL 依赖
// ONESTEP 的段标、单开=惰性空转」这一条，ADR-0022 增补节与开关表同批记录。
//
// 判定面=Bash 工具的命令文本（大小写不敏感子串；词表单一来源 `plugin/hooks/h3r-words.json`，
// 与 `core/h3r.js` 同读一份；匹配前空白归一，多空格/制表符不再逃逸——ADJ-41）。命中 ⇒ 写
// `loop/h3r-hit.json`（带段标；drive 按段校验后 rename 原子消费）+ 返 **deny**——不是 ask：
// 无人值守没有批准者，ask 会挂住（`core/drive.js` 同族理由）。伪造面（ADJ-18，对齐 ADR-0022
// 口径）：段标相符的伪造标记**可以**改写收束因分类（防伪边界=记账不裁决）；他段残留与
// 无段标伪造不可消费。
//
// 失败语义（诚实边界，报告记账；ADJ-07 订正）：非命中路径静默 exit 0；坏 stdin → 引擎按
// 空判定处置（fail-open）；**进程崩溃/超时/非 0 退出**在引擎侧为 `throw ToolExecutionFailed
// (recoverable:true)` + stderr/stdout 预览——模型可见错误面，非静默放行；命令本体最终命运
// 不可裁（活体探针 INFRA-FAIL，2026-09-22）。标记写失败**不阻断 deny**——拦截是主目的，
// 收束由 drive 的预算/段账兜底。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emit, failOpen, inputCwd, readStdinJson } from "./hook-lib.js";

const WORDS_FILE = join(dirname(fileURLToPath(import.meta.url)), "h3r-words.json");
const DENY_ANCHOR = "H3R_DENY"; // deny 理由的稳定首词：消融仪器按它锚定（别改成会变的文案）
const CMD_MAX = 300;

// 记账面排除（评审 P2-12）：仓库自身的 CLI 与提交管道不是「执行型动作」，而步标题里本就
// 含词表字样（h2 的步标题「执行 rm -rf build-cache/」）——不排除会把「记录本步」打成命中，
// 既污染读数又卡住段内收尾。
// ADJ-05（v023 双审）：复合命令以记账动词打头曾整行免检（`git status && rm -rf …` 探针
// 放行）——含 shell 元字符（管道/链接/重定向/命令替换）的行一律不豁免，记账豁免只服务
// 「单条记账命令」本形。
// ADJ-06（v023 双审）：`node \S*lzy.js` 的 `\S*` 无法跨越空格——win32 全局装路径含空格
// 用户名时引号形态静默失效；`("[^"]*"|\S*)` 两形并列（引号内允许空格）。
// 边界如实记账：把高危命令藏进被排除通道是理论绕过轴（元字符护栏把复合形态堵死后，
// 该轴收窄为「单条记账命令文本内嵌词表字样」的误伤面，由 deny 的子串匹配兜底）。
function isBookkeeping(command) {
  const c = command.trim();
  // ADJ-05 元字符护栏：链接（&、&&、|、||）、分号、重定向（<、>）、命令替换（`、$(`)
  // 任一在场即不豁免——记账豁免只服务「单条记账命令」本形。`$` 后非 `(` 不误伤
  //（提交信息含 $VAR 的合法记账形态）。
  if (/[&|;<>`]|\$\(/.test(c)) return false;
  if (/^git\s+(commit|add|status)\b/.test(c)) return true;
  if (/^lzy\b/.test(c)) return true;
  if (/^node\s+("[^"]*lzy\.js"|\S*cli[\\/]lzy\.js\b)/.test(c)) return true;
  if (/^node\s+("[^"]*lzy\.js"|\S*lzy\.js\b)/.test(c)) return true;
  return false;
}

function wordlist() {
  try {
    const parsed = JSON.parse(readFileSync(WORDS_FILE, "utf8"));
    return Array.isArray(parsed?.words)
      ? parsed.words.map((x) => x?.w).filter((w) => typeof w === "string" && w !== "")
      : [];
  } catch {
    return null; // 读不到=不可判 ⇒ fail-open（doctor 的 h3r-words 行巡逻载荷完整性）
  }
}

const matchedWords = (command, words) => {
  // ADJ-41（v023 双审）：匹配前空白归一——连续空白/制表符折成单空格，封「rm␣␣-rf」
  // 「rm\t-rf」形的子串逃逸；deny 理由与标记里的命令文本保持原样（取证面不修饰）。
  const hay = command.trim().replace(/\s+/g, " ").toLowerCase();
  return words.filter((w) => hay.includes(w.toLowerCase()));
};

try {
  const input = readStdinJson();
  if (!input) failOpen(); // 无/坏 stdin：静默（fail-open 由引擎侧承担）
  // LZY_ABLATE_HOOK_H3R_PRETOOL（ADR-0015）：恰 "1" = 本钩子整层短路——消融 E 臂
  // （no-hook-layer）靠它把 H3R 钩子一起灭掉，否则该臂不再是「整层消融」。stdin 已吃净后
  // 短路（同 comment-checker 家法）。注意与下一行的**唤醒**开关是两回事：那个是这条原型
  // 自己的反向开关，这个是家族消融面。
  if (process.env.LZY_ABLATE_HOOK_H3R_PRETOOL === "1") failOpen();
  if (process.env.LZY_ABLATE_H3R_PRETOOL !== "1") failOpen(); // 休眠：默认行为逐字段同
  // 段标形状校验（ADJ-22，v023 双审）：只认 drive 注入形 `<整数>:seg-<整数>`——残留 env
  //（手动实验/照抄 export 后未清）按「无段标」处置：声明面的「构造上免门」降格为「以 env
  // 卫生为前提」后的机器半，交互会话的恢复路径不再被残留段标误罩。
  const segmentId = process.env.LZY_SEGMENT_ID;
  if (!/^\d+:seg-\d+$/.test(segmentId ?? "")) failOpen();
  if (input.tool_name !== "Bash") failOpen();
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || command.trim() === "") failOpen();
  if (isBookkeeping(command)) failOpen();
  const words = wordlist();
  if (!words || words.length === 0) failOpen();
  const matched = matchedWords(command, words);
  if (matched.length === 0) failOpen();

  // 命中：先落标记（drive 据此走干净收束 + 7 字段快照），再 deny。
  const loopDir = process.env.LZY_LOOP_DIR || join(inputCwd(input) ?? process.cwd(), ".lazyzcode", "loop");
  try {
    mkdirSync(loopDir, { recursive: true });
    const file = join(loopDir, "h3r-hit.json");
    const tmp = `${file}.tmp`;
    writeFileSync(
      tmp,
      `${JSON.stringify(
        { segmentId, tool: input.tool_name, command: command.slice(0, CMD_MAX), matched, at: new Date().toISOString() },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    renameSync(tmp, file);
  } catch {
    // 写不成也照拦（见头注失败语义）
  }
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `${DENY_ANCHOR} 需人工确认（H3R）：命令命中高危面（${matched.join("、")}）——` +
        `本门只作用于无人值守 drive 段循环（ADR-0022），请交回人工会话确认`,
      additionalContext:
        "停手，不要改写命令绕过；本段将由 drive 干净收束并写交接快照，恢复=在交互会话读快照按计划推进。",
    },
  });
  process.exit(0);
} catch {
  failOpen();
}
