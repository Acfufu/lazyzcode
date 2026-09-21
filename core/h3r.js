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
import { nextStep } from "./loop.js";

// 词表每词带来源注释。前六枚是设计稿预注册的具名词（`docs/design-h3r-experiment.md`
// 「风险词表」行：`rm -rf` / `credentials` / `.env` / `--force` / `npm publish` / `chmod`），
// 其余为同族补充；**加词即改判定**，须在此处显式记账并同步契约测试。
export const H3R_WORDLIST = [
  // 破坏面（不可逆删除/覆盖）
  "rm -rf", // 预注册具名
  "rm -r ", // 同族：递归删除的另一种写法（带尾空格，避免与 "rm -rf" 重复计数）
  "rmdir ", // 同族：删目录
  "shred ", // 同族：不可恢复擦除
  "truncate ", // 同族：原地截断覆盖
  // 凭据面（读取/搬运认证物料）
  "credentials", // 预注册具名
  ".env", // 预注册具名
  "id_rsa", // 同族：默认私钥文件名
  "ssh key", // 同族：私钥类别
  // 不可逆发布/强推面
  "npm publish", // 预注册具名
  "--force", // 预注册具名；子串覆盖 git push --force / --force-with-lease / 各工具强推
  // 权限面
  "chmod ", // 预注册具名
  "chown ", // 同族：属主变更
];

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
  const hits = H3R_WORDLIST.filter((w) => hay.includes(w.toLowerCase()));
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
