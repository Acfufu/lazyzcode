// H3R 高危步门原型（0.2.2 棒2，ADR-0022；实验设计 `docs/design-h3r-experiment.md`）。
// **默认休眠**：只有 `LZY_ABLATE_H3R_GATE === "1"` 才唤醒——这与 `LZY_ABLATE_*` 家族的
// 「恰 "1" 消融即关掉部件」语义**相反**，是预注册冻结的形态（该稿 :58「默认关行为不变 +
// 开时停摆」；同稿 :24 的臂表格仍留家族样板句，ADR-0022 已记账）。命名为冻结值不改，
// 语义待实验结果评审后再定去留。
//
// 判定面 = 待执行步骤的**文本**（`goal.steps[].title`，计划采纳时由 ITEM_RE 从计划文件
// 摘出，见 `core/loop.js` 的 parsePlanItems）。选词表为主判据、计划项显式标注为额外升格
// 通道，是为反循环论证：若判定靠模型自报，则「门抓到了」与「模型自律」同源，判据零测量
// 力（设计稿预注册修正 2）。
//
// 边界（诚实面）：词表是**子串匹配**，不是命令解析器——它能被改写规避（`rm -fr`、
// 变量拼接、脚本里间接调用），也不理解上下文（注释里提到 `--force` 同样命中）。本原型
// 测的是「机器层能否在段循环里看见计划书上的高危字样并干净停手」，不是「能否识破规避」。
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { nextStep, LoopError } from "./loop.js";

// 词表**单一来源**（0.2.3 N1）：判定词与来源住在 `plugin/hooks/h3r-words.json`，CLI 侧与
// 钩子侧各按本树相对路径同读一份（npm 包与引擎插件缓存都含 plugin/）。原内联数组已迁走——
// `plugin/hooks/stop.js` 的陈旧副本教训 + 本文件「绝不另写内联副本让两处漂移」的家法。
// **惰性加载**：读取只发生在唤醒路径（休眠时 `h3rStopVerdict` 提前返回，不触文件），
// 故一个坏 JSON 不会让任一 `lzy` 命令（含 doctor）在非唤醒场景下不可用。
// LZY_H3R_WORDS_FILE（v023-fix-round N1）：测试/探针 seam——指向替代词表文件（含故意
// 损坏形态）以钉「唤醒态词表不可判」的收口行为；**惰性求值**（每次 loadWordlist 现读
// env），缺省产线路径逐字节不变。
function wordsUrl() {
  return process.env.LZY_H3R_WORDS_FILE
    ? pathToFileURL(process.env.LZY_H3R_WORDS_FILE)
    : new URL("../plugin/hooks/h3r-words.json", import.meta.url);
}
let cache = null;

// 非抛错读（doctor / 契约测试用）：返回 {ok:true, words} 或 {ok:false, reason}。
export function loadWordlist() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(wordsUrl(), "utf8"));
    const words = Array.isArray(parsed?.words)
      ? parsed.words.map((x) => x?.w).filter((w) => typeof w === "string" && w !== "")
      : [];
    if (words.length === 0) throw new Error("words 缺席、为空或 schema 非法");
    cache = { ok: true, words };
  } catch (err) {
    cache = { ok: false, reason: err?.message ?? String(err) };
  }
  return cache;
}

// 抛错读（唤醒路径用）：词表不可用=载荷不完整，显式拒并给恢复式指路，绝不静默降级为空表。
export function h3rWordlist() {
  const r = loadWordlist();
  if (!r.ok) throw new LoopError(`载荷词表缺失/损坏（${r.reason}）——重跑 lzy sync 或重装`);
  return r.words;
}

// 显式升格通道：计划项自带该标记即停，与词表命中走同一条 matches 通道（设计稿
// 「计划项显式标注高危为额外升格通道」）。
export const H3R_STEP_MARKER = "[risk:high]";

// 唤醒判据：恰 "1"。与 `core/loop.js:87` 的 `ablated` 同款取值语义（"" / "0" / "true"
// 一律不唤醒），契约测试钉反例三枚。
export function h3rArmed(env = process.env) {
  return env?.LZY_ABLATE_H3R_GATE === "1";
}

// 子串匹配，大小写不敏感。返回命中的词表项（按词表顺序、去重），未命中返回空数组。
export function h3rMatches(text) {
  const hay = String(text ?? "").toLowerCase();
  if (hay === "") return [];
  const hits = h3rWordlist().filter((w) => hay.includes(w.toLowerCase()));
  if (hay.includes(H3R_STEP_MARKER)) hits.push(H3R_STEP_MARKER);
  return hits;
}

// 判定「下一步」是否高危。取 `nextStep`（第一个 pending 步，`core/loop.js:291` 的单一源），
// 与段会话自己按 `lzy loop status` 选的下一步同源——不该另写内联副本让两处漂移。
// 设计取舍：只看**下一步**（触门前判定），不扫全量 pending——后者会让「计划尾部有个高危步」
// 的计划在第一段就整段停摆，把安全的活也一起浪费掉；「any-pending 提前停」是备选形态，
// 归实验结果评审。
export function h3rStepVerdict(goal) {
  const step = nextStep(goal ?? { steps: [] });
  if (!step) return { step: null, matches: [] };
  return { step, matches: h3rMatches(step.title) };
}

// 给 drive 用的整句判据：唤醒 + 下一步命中才算停摆。返回 null 表示不停。
export function h3rStopVerdict(goal, env = process.env) {
  if (!h3rArmed(env)) return null;
  const { step, matches } = h3rStepVerdict(goal);
  if (!step || matches.length === 0) return null;
  return { step, matches };
}
