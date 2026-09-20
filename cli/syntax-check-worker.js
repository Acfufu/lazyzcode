// doctor 语法自检 worker：由 core/doctor.js 以全字面量 argv spawn（--experimental-vm-modules
// + 本文件路径 + 静态目录参数）。对目录内 .js 做 ESM 语法解析——vm.SourceTextModule 仅
// parse 不执行（不读 stdin、不写文件、无网络）；hooks.json 做 JSON 解析与顶层形状校验
// ——它是钩子注册的根，拼错=整层纪律静默失效（评审 R3-4）。结果以 JSON 数组写 stdout。
// ADJ-65（0.2.1）：注册校验补「command → 文件」在场判定——旧实现只验 JSON 顶层形状，
// 五处 command 全改错名仍打 ✔（历史 `run-hook.sh → run-hook` 退役正是这类改动，
// 守卫盲区+假安心）。判据=取 command 末 token 相对本目录解析存在（含无扩展名对偶孪生
// run-hook / run-hook.cmd：PATHEXT 由引擎侧解析，这里只核「文件在场」）。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const dirs = process.argv.slice(2);
const broken = [];

// entry.command 的每个路径 token 必须相对本 hooks/ 目录在场（ADJ-65）。
// 真实形状（plugin/hooks/hooks.json）：事件数组的每条 = {matcher?, hooks:[{type,command,timeout}]}，
// command 形如 `"${ZCODE_PLUGIN_ROOT}/hooks/run-hook" comment-checker.js`——两段都要核：
// 启动器 run-hook 与脚本名。判据=剥引号后取 token 的 basename，相对 dir 存在即过
//（`${…}` 变量只取其 / 后段；纯旗标 token 跳过，不妄判）。
function commandProblems(dir, ev, command) {
  const problems = [];
  for (const rawTok of String(command).trim().split(/\s+/)) {
    const tok = rawTok.replace(/^["']|["']$/g, "");
    if (!tok || tok.startsWith("-")) continue;
    const name = tok.slice(tok.lastIndexOf("/") + 1);
    if (!name || name.includes("${")) continue;
    if (!existsSync(join(dir, name))) {
      problems.push(
        `${ev} 的 command 引用「${name}」但 ${join(dir, name)} 不存在——钩子会静默失效（run-hook / run-hook.cmd 对偶孪生与脚本本体都须在场）`,
      );
    }
  }
  return problems;
}

// 事件条目 → 命令列表（兼容两种形状：{command} 直挂 与 {hooks:[{command}]} 嵌套）。
function commandsOf(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.map((h) => (h && typeof h === "object" ? h.command : null));
  }
  return [entry.command];
}
for (const dir of dirs) {
  let hookJson;
  try {
    hookJson = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8"));
  } catch (err) {
    if (err?.code !== "ENOENT") {
      broken.push({ file: join(dir, "hooks.json"), reason: `JSON 解析失败：${err.message}` });
    }
    hookJson = null;
  }
  if (hookJson) {
    // 官方形状 {description, hooks:{事件:[…]}}；裸事件表也兼容。
    const events =
      typeof hookJson === "object" && !Array.isArray(hookJson) ? (hookJson.hooks ?? hookJson) : null;
    if (!events || typeof events !== "object" || Array.isArray(events)) {
      broken.push({
        file: join(dir, "hooks.json"),
        reason: "顶层应为对象（{description, hooks:{事件:[…]}}）",
      });
    } else {
      for (const [ev, entries] of Object.entries(events)) {
        if (!Array.isArray(entries)) {
          broken.push({ file: join(dir, "hooks.json"), reason: `${ev} 的值应为数组` });
          continue;
        }
        for (const entry of entries) {
          const commands = commandsOf(entry);
          if (commands === null) {
            broken.push({ file: join(dir, "hooks.json"), reason: `${ev} 的条目应为对象` });
            continue;
          }
          for (const cmd of commands) {
            if (typeof cmd !== "string" || !cmd.trim()) {
              broken.push({ file: join(dir, "hooks.json"), reason: `${ev} 的条目缺 command 字符串` });
              continue;
            }
            for (const p of commandProblems(dir, ev, cmd)) {
              broken.push({ file: join(dir, "hooks.json"), reason: p });
            }
          }
        }
      }
    }
  }
  let files = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => join(dir, f));
  } catch {
    files = []; // 目录不存在=无可检项，由父进程按存在性报告
  }
  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      broken.push({ file, reason: `不可读：${err.message}` });
      continue;
    }
    try {
      new vm.SourceTextModule(source);
    } catch (err) {
      broken.push({ file, reason: err?.message ?? "语法解析失败" });
    }
  }
}
process.stdout.write(JSON.stringify(broken));
