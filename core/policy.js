// 策略身份与义务生成（0.4.0 M1，docs/plan-v040-engineering-policy.md §3/§7；ADR-0033 的
// 记录底座）。职责边界：本模块从冻结输入**确定性导出**义务集——同输入二次生成逐字节恒等
//（V01）；不做模型执行、不取证、不外发、不产生授权。义务=带稳定 id 的判定对象
//（id/type/source/适用理由/验收映射/满足条件/依赖边界/版本），type∈check/review/ci/
// delivery-audit。底线义务（通用正确性评审）只增不删（§3.2）；额外义务取消唯 reassess
// 独立复判通道（M3 N8，ADR-0033：影响变化/取消理由/复判依据三件套入 obligationsLog，
// 未解决的阻塞发现不在取消通道内）。影响扩大=显式 expand 追加并记前后差异；任务运行期间
// 固定策略版本——输入身份漂移按阻塞判（V02），不自动重导（静默换策略=未授权放行面）。
// 记录家族 `.lazyzcode/policy/<slug>.a<attempt>.json`：loadFamilyFile/saveFamilyFile
// 家法（校验和+版本+形状 fail-closed，原子写 0600）；tmp 登记面=core/loop.js
// ANY_TMP_SCAN_DIRS（观测面与清扫面同一判据）。
// 适用域（拍板 5/7）：仅 v2（带策略身份）目标；v1 旧目标按旧规则延续，政策裁决不适用。
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadProjectManifest } from "./project.js";
import { loadContract, manifestHashIfPresent } from "./contract.js";
import { readGoal } from "./loop.js";
import { openBlockingFindings } from "./findings.js"; // M3 N8：review 义务取消的未关闭发现拒面（findings.js 无反向依赖，无环）
import { loadFamilyFile, saveFamilyFile, QueueError } from "./queue.js";
import { DUTY_TABLE as REVIEW_DUTY_TABLE, dutyTemplateHash, dutySuiteHash } from "./review.js"; // 0.4.0 M2 N5：职责模板内容哈希入 rulesHash（call-time 用，ESM 环安全）；M4：declarable 职责套件哈希同入

// M3 N8 升版：v2=reassess 取消通道起（obligationsLog removed 条目合法形）——读侧放宽
//（v1=M1/M2 代记录保持可读，写恒 v2；沿 dutyTableVersion 读侧放宽先例）。
export const POLICY_VERSION = 2;
// 0.4.0 M4 N4 翻面：三条专项职责入表（ADR-0032 同批），职责表 v3→v4
//（dutyTableVersion 参与 rulesHash，翻面=策略身份变化——在途旧记录不自动替换，§3.1；
// 本 goal 自身在途记录随之漂移，由计划 N11 收口相位 supersede 再采纳收口）。
export const DUTY_TABLE_VERSION = 4;
export const REVIEW_RUNNER_FACE = Object.freeze({ available: true });
export const OBLIGATION_TYPES = ["check", "review", "ci", "delivery-audit"];
export const BASELINE_REVIEW_ID = "review.general-correctness";

export class PolicyError extends Error {}

// 规则内容哈希（§3.1 记录面）：覆盖塑形导出的配置面（义务表版本/类型域/运行器旗标/职责
// 模板内容哈希——M2 N5 增补：模板文本即职责定义的内容面，漂移同样构成规则版本变化），
// 不覆盖导出产物本身（那是 obligations 内容，随输入走）。
export function policyRulesHash() {
  const dutyTemplates = {};
  const dutySuites = {};
  for (const d of REVIEW_DUTY_TABLE) {
    dutyTemplates[d.id] = dutyTemplateHash(d.id);
    // M4 N4：declarable 职责的挑战套件内容哈希同入规则面——套件编辑=新规则版本（与模板同纪律）；
    // whole-candidate 职责无套件（null 占位，键仍在=表内容面完整覆盖）。
    dutySuites[d.id] = dutySuiteHash(d.id);
  }
  return createHash("sha256")
    .update(JSON.stringify({ dutyTableVersion: DUTY_TABLE_VERSION, types: OBLIGATION_TYPES, runnerFace: REVIEW_RUNNER_FACE, dutyTemplates, dutySuites }))
    .digest("hex");
}

// 稳定序列化：键序归一——同输入恒同串（V01 的确定性底座；对象键无序是 JS 事实）。
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function identityStableHash(identity) {
  return createHash("sha256").update(stableStringify(identity)).digest("hex");
}

// 输入身份（§3.1 冻结输入；候选身份不在轴内——gate 快照承载时点绑定）。契约文件磁盘
// 字节与绑定哈希不符时如实带旗（contractDrift），由闸面判无效——policy 不冒充仲裁。
export function computePolicyIdentity(cwd, goal) {
  const identity = {
    slug: goal.slug,
    attempt: goal.attempt ?? 0,
    goalVersion: goal.version,
    tier: goal.tier ?? null,
    risk: goal.risk ?? null,
    contractHash: goal.contract?.contractHash ?? null,
    endpoint: null,
    subjectsCount: Array.isArray(goal.subjects) ? goal.subjects.length : 0, // M4 N4 拍板 6：state-recovery 推导轴
    contractDrift: false,
    manifestPresent: false,
    manifestHash: null,
    manifestInvalid: false,
    checkIds: [],
    ciRequiredChecks: [], // N3 接线：project.js 承认 capabilities.ci 后由 loadProjectManifest 供源
  };
  if (goal.contract) {
    try {
      const loaded = loadContract(goal.contract.path, cwd);
      identity.endpoint = loaded.endpoint;
      if (loaded.hash !== goal.contract.contractHash) identity.contractDrift = true;
    } catch {
      identity.endpoint = null;
      identity.contractDrift = true; // 契约文件不可读/解析失败——闸面按无效判，不猜
    }
  }
  // 清单身份（0.4.0 M1 N8 收口）：字节哈希恒为锚（=契约 recipe 绑定的同一算法，contract.js
  // manifestHashIfPresent 单源）；清单**解析失败**不使身份不可算——如实记 manifestInvalid
  // 旗交闸面阻塞，不让「清单坏了」在采纳面变成比契约门（查 e 只看字节）更严的新前置。
  const bytes = manifestHashIfPresent(cwd);
  if (bytes !== null) {
    identity.manifestPresent = true;
    identity.manifestHash = bytes;
  }
  try {
    const manifest = loadProjectManifest(cwd);
    if (manifest) {
      identity.checkIds = manifest.manifest.capabilities.check.map((r) => r.id).sort();
      // ci 必需集合（0.4.0 M1 N3 接线：project.js validateManifest 承认并验形后在此供源）
      const ci = manifest.manifest.capabilities.ci;
      if (ci?.requiredChecks) identity.ciRequiredChecks = [...ci.requiredChecks].sort();
    }
  } catch {
    identity.manifestInvalid = true;
  }
  return identity;
}

// 确定性义务导出（V01）：顺序恒定（review 底线→review 专项→checkIds 字典序→ci→delivery-audit），
// 无时戳、无环境读数。纯函数——测试同输入两调逐字节断言。
export function deriveObligations(identity) {
  const obligations = [];
  const manifestRef = identity.manifestPresent ? `manifest:${identity.manifestHash.slice(0, 8)}` : "manifest:absent";
  // 评审义务满足条件串（M4 N4 与 gate 复用合取同源措辞）：base 七合取或复用腿二选一满足。
  const REVIEW_SATISFACTION =
    "同 (slug,attempt) 代次的受控评审运行在案：duty/dutyTableVersion/模板哈希与现行规则一致 ∧ validity=valid ∧ metering=metered ∧ verdict=pass ∧ 候选三字段=现行 ∧ 原始输出在场哈希相符（lzy review run）∨ 复用腿（M4，ADR-0032）：在案 applicable 适用档（base 运行过资格挑战 ∧ 资格身份（rulesHash/模板/契约/清单/引擎）全现行 ∧ 目标候选=现行 ∧ diff 分类完备）替代候选现行合取项；∧ 无未关闭阻塞发现 ∧ 关闭依据仍适用（发现账本 findings 子句，V06——关闭唯 resolve-request → review recheck → close 通道，stale 发现经 finding reopen 重走复核）";
  // ① 通用正确性评审（底线，§3.1 必选）：全部 v2 目标恒生成，无契约亦生成（拍板 7）。
  obligations.push({
    id: BASELINE_REVIEW_ID,
    type: "review",
    baseline: true,
    source: `policy.dutyTable.v${DUTY_TABLE_VERSION}`,
    appliesBecause: "通用正确性评审职责必选（§3.1）——全部 v2 目标",
    acceptanceIds: [],
    satisfaction: REVIEW_SATISFACTION,
    dependsOn: ["runner:controlled-review"],
    version: POLICY_VERSION,
  });
  // ①′ 三条专项职责（M4 N4，拍板 6——确定性推导，只吃身份既有事实面，不吃模型分类）：
  //   verification-deps：清单声明 check 配方或必需 CI（有验证依据才有验证依赖面）；
  //   external-side-effects：riskClass med+ 或契约 endpoint B/C（权限/外发/交付面在场）；
  //   state-recovery：subjects>1 或 endpoint B/C（跨仓状态与交付状态面在场）。
  const derivedDuties = [];
  if ((identity.checkIds?.length ?? 0) > 0 || (identity.ciRequiredChecks?.length ?? 0) > 0) {
    derivedDuties.push({
      id: "review.verification-deps",
      because: `项目清单声明验证依据（check ${(identity.checkIds ?? []).length} 项 · CI ${(identity.ciRequiredChecks ?? []).length} 项）——验证依赖面在场`,
    });
  }
  const externalSurface = ["med", "high", "restricted"].includes(identity.risk) || identity.endpoint === "B" || identity.endpoint === "C";
  if (externalSurface) {
    derivedDuties.push({
      id: "review.external-side-effects",
      because: `权限/外发面在场（risk=${identity.risk ?? "null"} · endpoint=${identity.endpoint ?? "null"}）——外部副作用评审`,
    });
  }
  const stateSurface = (identity.subjectsCount ?? 0) > 1 || identity.endpoint === "B" || identity.endpoint === "C";
  if (stateSurface) {
    derivedDuties.push({
      id: "review.state-recovery",
      because: `跨仓/交付状态面在场（subjects=${identity.subjectsCount ?? 0} · endpoint=${identity.endpoint ?? "null"}）——状态与恢复评审`,
    });
  }
  for (const d of derivedDuties) {
    obligations.push({
      id: d.id,
      type: "review",
      baseline: false,
      source: `policy.dutyTable.v${DUTY_TABLE_VERSION}.derived`,
      appliesBecause: d.because,
      acceptanceIds: [],
      satisfaction: REVIEW_SATISFACTION,
      dependsOn: ["runner:controlled-review"],
      version: POLICY_VERSION,
    });
  }
  // ② check 义务：项目清单 check 类配方逐条（清单为源；映射经回执 acceptanceIds 承载）。
  for (const id of identity.checkIds) {
    obligations.push({
      id: `check.${id}`,
      type: "check",
      baseline: false,
      source: `${manifestRef}.capabilities.check[]`,
      appliesBecause: `项目清单（${identity.manifestPresent ? identity.manifestHash.slice(0, 8) : "absent"}）check 类配方声明——v2 目标必需检查`,
      acceptanceIds: [],
      satisfaction: "同 checkId 回执在案：契约归属一致 ∧ 适用（judgeReuse）∧ 成功（exit==0）∧ 候选=现行",
      dependsOn: identity.manifestPresent ? [manifestRef] : [],
      version: POLICY_VERSION,
    });
  }
  // ③ CI 义务：清单声明必需集合时生成一条（V10 严判：仅 success 计绿）。
  if (identity.ciRequiredChecks.length > 0) {
    obligations.push({
      id: "ci.required-checks",
      type: "ci",
      baseline: false,
      source: `${manifestRef}.capabilities.ci.requiredChecks`,
      appliesBecause: `项目清单声明必需 CI 集合（${identity.ciRequiredChecks.length} 项）——§6 必需集合语义`,
      acceptanceIds: [],
      requiredChecks: [...identity.ciRequiredChecks],
      satisfaction: "必需集合逐项在当前候选提交上 conclusion==success；缺项/空结果/neutral/skipped/cancelled/pending/查询失败均非绿",
      dependsOn: identity.manifestPresent ? [manifestRef, "candidate:head"] : ["candidate:head"],
      version: POLICY_VERSION,
    });
  }
  // ④ 交付核对义务：endpoint B/C 契约目标（ADR-0028）。无在案意图=无可核对事实，评定期
  // 不阻塞（首外发由 delivery 面既有门执法）——生成只看契约 endpoint，不看运行时账。
  if (identity.endpoint === "B" || identity.endpoint === "C") {
    obligations.push({
      id: "delivery.audit",
      type: "delivery-audit",
      baseline: false,
      source: `contract:${identity.contractHash ? identity.contractHash.slice(0, 8) : "null"}.endpoint`,
      appliesBecause: `契约 endpoint=${identity.endpoint}——交付事实核对（ADR-0028）`,
      acceptanceIds: [],
      satisfaction: "交付意图在案时核对：合并事实保留 ∧ merge CI 非失败；无在案意图=无可核对事实，不阻塞",
      dependsOn: ["delivery:intents"],
      version: POLICY_VERSION,
    });
  }
  return obligations;
}

function policyRecordPath(cwd, slug, attempt) {
  return join(cwd, ".lazyzcode", "policy", `${slug}.a${attempt ?? 0}.json`);
}

function assertObligationShape(o, where) {
  const bad = (m) => new QueueError(`策略记录义务形状非法（${where}）：${m}`);
  if (!o || typeof o !== "object") throw bad("须为对象");
  for (const k of ["id", "type", "source", "appliesBecause", "satisfaction"]) {
    if (typeof o[k] !== "string" || !o[k]) throw bad(`${k} 缺席或为空`);
  }
  if (!OBLIGATION_TYPES.includes(o.type)) throw bad(`type 不识别：${o.type}（合法：${OBLIGATION_TYPES.join("|")}）`);
  if (!Array.isArray(o.acceptanceIds)) throw bad("acceptanceIds 须为数组");
  if (!Array.isArray(o.dependsOn)) throw bad("dependsOn 须为数组");
  if (o.version !== POLICY_VERSION && o.version !== 1) throw bad(`version 不符（${o.version} ∉ {${POLICY_VERSION},1}）`);
  if (o.baseline !== undefined && typeof o.baseline !== "boolean") throw bad("baseline 须为布尔或缺席");
}

function assertPolicyShape(rec, p) {
  const bad = (m) => new QueueError(`策略记录形状非法：${m}：${p}`);
  for (const k of ["slug", "inputsHash", "rulesHash"]) {
    if (typeof rec[k] !== "string" || !rec[k]) throw bad(`${k} 缺席或为空`);
  }
  if (typeof rec.attempt !== "number") throw bad("attempt 须为数字");
  if (rec.policyVersion !== POLICY_VERSION && rec.policyVersion !== 1) {
    throw bad(`policyVersion 不符（${rec.policyVersion} ∉ {${POLICY_VERSION},1}）`);
  }
  // 读侧放宽（0.4.0 M2 N5 拍板 2）：dutyTableVersion 只要求正整数——旧规则版本档保持可读，
  // 版本漂移一律由 rulesHash 子句判（gate ③「规则版本漂移…采纳提案」），不在此 fail-closed。
  if (!Number.isInteger(rec.dutyTableVersion) || rec.dutyTableVersion < 1) {
    throw bad(`dutyTableVersion 须为正整数（${rec.dutyTableVersion}）`);
  }
  if (!rec.inputs || typeof rec.inputs !== "object") throw bad("inputs 缺席");
  if (!Array.isArray(rec.obligations) || rec.obligations.length === 0) throw bad("obligations 须为非空数组");
  const seen = new Set();
  for (const o of rec.obligations) {
    assertObligationShape(o, p);
    if (seen.has(o.id)) throw bad(`义务 id 重复：${o.id}`);
    seen.add(o.id);
  }
  // 底线不可删（§3.2）：读侧即验——篡改/手补绕不过形状关。
  if (!rec.obligations.some((o) => o.id === BASELINE_REVIEW_ID && o.baseline === true)) {
    throw bad(`底线义务 ${BASELINE_REVIEW_ID}（baseline:true）缺席——底线只增不删`);
  }
  if (!Array.isArray(rec.obligationsLog)) throw bad("obligationsLog 须为数组");
  for (const e of rec.obligationsLog) {
    if (!e || typeof e.at !== "string" || typeof e.event !== "string") throw bad("obligationsLog 项须有 at/event");
    if (!Array.isArray(e.added) || !Array.isArray(e.removed)) throw bad("obligationsLog 项 added/removed 须为数组");
    if (e.removed.length > 0) {
      // M3 N8（ADR-0033）：removed 条目唯 reassess 事件合法——三件套（影响变化/取消理由/
      // 复判依据）逐字段非空，取消后义务集不得仍含被取消 id（历史不改写：取消只追加）。
      if (e.event !== "reassess") throw bad("obligationsLog 项 removed 非空但 event 非 reassess——取消唯独立复判通道（lzy policy reassess）");
      for (const k of ["impactChange", "cancelReason", "basis"]) {
        if (typeof e[k] !== "string" || !e[k].trim()) throw bad(`obligationsLog reassess 项 ${k} 缺席或为空（ADR-0033 三件套必填）`);
      }
      const after = new Set(e.obligationsAfter ?? []);
      for (const id of e.removed) {
        if (after.has(id)) throw bad(`obligationsLog reassess 项 obligationsAfter 仍含被取消义务 ${id}`);
      }
    }
    if (!Array.isArray(e.obligationsAfter)) throw bad("obligationsLog 项 obligationsAfter 须为数组");
  }
}

export function loadPolicyRecord(cwd, slug, attempt) {
  return loadFamilyFile(policyRecordPath(cwd, slug, attempt), {
    versionKey: "schemaVersion",
    version: [POLICY_VERSION, 1], // v1 档读侧放宽（家族版本闸层——N8 自审 r5-F1 收口）；写恒 v2
    label: "策略记录",
    shapeFn: assertPolicyShape,
  });
}

// 按路径读（doctor 巡逻面用）：给定文件直接过家族闸（校验和+版本+形状），不推导 slug。
export function loadPolicyFile(p) {
  return loadFamilyFile(p, {
    versionKey: "schemaVersion",
    version: [POLICY_VERSION, 1],
    label: "策略记录",
    shapeFn: assertPolicyShape,
  });
}

// ensure：读在案记录（v1 目标={applicable:false}，不建不读）；无记录→生成落档；有记录且
// 输入身份一致→原样返回；有记录但漂移→**不重导**，drifted=true 连原因返回（闸面阻塞，
// V02）。expand=true 才允许输入扩大下的重导：只增不删（删除即 PolicyError），差异入
// obligationsLog。返回不携带写失败的中间态——写失败即抛（原子写家法）。
export function ensurePolicyRecord(cwd, goal, { expand = false, reason = null } = {}) {
  if (!goal || goal.version !== 2) return { applicable: false };
  const identity = computePolicyIdentity(cwd, goal);
  const inputsHash = identityStableHash(identity);
  const prev = loadPolicyRecord(cwd, goal.slug, goal.attempt);
  if (prev && prev.inputsHash === inputsHash) {
    return { applicable: true, record: prev, created: false, expanded: false, drifted: false };
  }
  if (prev && !expand) {
    return {
      applicable: true,
      record: prev,
      created: false,
      expanded: false,
      drifted: true,
      driftReasons: [
        `策略输入身份漂移（在案 ${prev.inputsHash.slice(0, 8)} ≠ 现算 ${inputsHash.slice(0, 8)}）` +
          `——任务运行期间固定策略版本（§3.1），漂移按阻塞判（V02）；影响合法扩大走显式 expand`,
      ],
    };
  }
  const obligations = deriveObligations(identity);
  let log = [];
  if (prev && expand) {
    const prevIds = new Set(prev.obligations.map((o) => o.id));
    const added = obligations.filter((o) => !prevIds.has(o.id)).map((o) => o.id);
    const removed = prev.obligations.filter((o) => !obligations.some((o2) => o2.id === o.id)).map((o) => o.id);
    if (removed.length > 0) {
      throw new PolicyError(
        `expand 不得删义务（${removed.join("、")}）——额外义务因影响消失而取消走独立复判通道：lzy policy reassess <义务id> --impact … --cancel-reason … --basis …（ADR-0033，§3.2）`,
      );
    }
    for (const o of prev.obligations) {
      if (o.baseline === true && !obligations.some((o2) => o2.id === o.id && o2.baseline === true)) {
        throw new PolicyError(`expand 不得降格底线义务：${o.id}（§3.2 底线不可撤销）`);
      }
    }
    log = [
      ...prev.obligationsLog,
      {
        at: new Date().toISOString(),
        event: "expand",
        from: prev.inputsHash,
        to: inputsHash,
        added,
        removed: [],
        obligationsAfter: obligations.map((o) => o.id),
        reason: reason ?? "影响扩大重导（显式 expand）",
      },
    ];
  }
  const record = {
    schemaVersion: POLICY_VERSION,
    slug: goal.slug,
    attempt: goal.attempt ?? 0,
    policyVersion: POLICY_VERSION,
    dutyTableVersion: DUTY_TABLE_VERSION,
    rulesHash: policyRulesHash(),
    runnerFace: { ...REVIEW_RUNNER_FACE },
    inputs: identity,
    inputsHash,
    obligations,
    obligationsLog: log,
  };
  saveFamilyFile(policyRecordPath(cwd, goal.slug, goal.attempt), record, {
    versionKey: "schemaVersion",
    version: POLICY_VERSION,
    label: "策略记录",
    shapeFn: assertPolicyShape,
  });
  return { applicable: true, record, created: !prev, expanded: Boolean(prev && expand), drifted: false };
}

// 义务复判（0.4.0 M3 N8，ADR-0033）：额外义务因影响消失而取消的唯一通道。三件套必填入
// obligationsLog（event=reassess：impactChange/cancelReason/basis）；历史只追加不改写。
// 拒绝面（V07）：baseline（现行分级强制/底线）拒；现行推导仍含该义务拒（取消无独立依据——
// 影响变化须先落到输入面：契约/清单/目标字段，使推导自然不再生成它）；review 型义务存在
// 未关闭阻塞发现拒（未解决的阻塞发现不在取消通道内——借取消删发现被拒）。
export function reassessObligation(cwd, goal, obligationId, { impactChange, cancelReason, basis } = {}) {
  if (!goal || goal.version !== 2) throw new PolicyError("义务复判须 v2 活跃目标");
  for (const [k, v] of Object.entries({ impactChange, cancelReason, basis })) {
    if (typeof v !== "string" || !v.trim()) {
      throw new PolicyError(`reassess 三件套缺 ${k}（ADR-0033：影响变化/取消理由/复判依据必填）`);
    }
  }
  const rec = loadPolicyRecord(cwd, goal.slug, goal.attempt);
  if (!rec) throw new PolicyError("策略记录缺席——无可复判义务（先采纳落档）");
  const ob = rec.obligations.find((o) => o.id === obligationId);
  if (!ob) throw new PolicyError(`义务不在案：${obligationId}（lzy policy show 看现行义务集）`);
  if (ob.baseline === true) {
    throw new PolicyError(`义务 ${obligationId} 为 baseline（现行分级强制/底线）——不在取消通道（ADR-0033 §5：取消不侵入契约与分级底线）`);
  }
  const derived = deriveObligations(computePolicyIdentity(cwd, goal));
  if (derived.some((o) => o.id === obligationId)) {
    throw new PolicyError(
      `取消无独立依据：义务 ${obligationId} 仍由现行输入身份推导（影响变化须先落到输入面——契约/清单/目标字段变更使推导不再生成它）`,
    );
  }
  if (ob.type === "review") {
    const open = openBlockingFindings(cwd, goal.slug);
    if (open.length > 0) {
      throw new PolicyError(
        `review 义务存在未关闭阻塞发现 ${open.length} 条（${open.slice(0, 3).map((f) => f.fingerprint.slice(0, 8)).join("、")}）——未解决的阻塞发现不在取消通道内（V07）；先走发现生命周期：lzy review recheck → lzy finding close`,
      );
    }
  }
  const after = rec.obligations.filter((o) => o.id !== obligationId).map((o) => o.id);
  rec.obligations = rec.obligations.filter((o) => o.id !== obligationId);
  rec.obligationsLog.push({
    at: new Date().toISOString(),
    event: "reassess",
    from: rec.inputsHash,
    to: rec.inputsHash,
    added: [],
    removed: [obligationId],
    impactChange: impactChange.trim(),
    cancelReason: cancelReason.trim(),
    basis: basis.trim(),
    obligationsAfter: after,
  });
  saveFamilyFile(policyRecordPath(cwd, goal.slug, goal.attempt), rec, {
    versionKey: "schemaVersion",
    version: POLICY_VERSION,
    label: "策略记录",
    shapeFn: assertPolicyShape,
  });
  return { removed: obligationId, obligationsAfter: after };
}
