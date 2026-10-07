// 项目能力清单（0.3.0 M1，主方案 §3.2）：`lzy.project.json` 随仓库版本化，六类能力
// （prepare/start/check/observe/cleanup/delivery）各带配方——稳定 id、明确 argv（无 shell
// 串）、cwd、超时、所需环境变量**名单**（值运行时注入，清单不落凭据）、允许写入位置。
// 职责边界：本模块=schema 校验+只读发现（discover）+就绪检查（check 的「入口存在」态）；
// 真实执行与回执归 M2 core/verify.js。配方信任流=契约引用其内容哈希并经用户批准
//（core/contract.js manifestHashIfPresent），清单变更→授权重估。零 spawn、全部同步。
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const PROJECT_MANIFEST_VERSION = 1;
export const CAPABILITY_CLASSES = ["prepare", "start", "check", "observe", "cleanup", "delivery"];

export class ProjectError extends Error {}

const RECIPE_CLASSES = new Set(["string", "number", "boolean"]);

function projectManifestPath(cwd) {
  return join(cwd, "lzy.project.json");
}

// 清单身份：内容字节 sha256（与 contract.recipe 绑定的是同一个哈希；core/contract.js
// 的 manifestHashIfPresent 即本函数的轻量形态——同一文件的同一算法，两处永不分叉）。
export function manifestHash(cwd) {
  return createHash("sha256").update(readFileSync(projectManifestPath(cwd))).digest("hex");
}

// 读+校验：缺席（仅 ENOENT）=null（discover/check 各自决定呈现）；其余读失败/解析失败/
// 形状非法=ProjectError 拒（受信执行输入不允许「坏了当没看见」——与 approvals 的 skip
// 家族划清界限，理由同 authorizations：静默放行=错误复用面）。
export function loadProjectManifest(cwd) {
  const p = projectManifestPath(cwd);
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new ProjectError(`项目清单不可读（${err?.code ?? err?.message ?? err}）：${p}`);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new ProjectError(`项目清单损坏（JSON 解析失败）：${p}——修好 JSON 或 lzy project discover 看缺失面`);
  }
  const manifest = validateManifest(obj, cwd);
  return { manifest, hash: manifestHash(cwd), path: p };
}

function reject(msg) {
  throw new ProjectError(`项目清单非法：${msg}`);
}

function validateRecipe(cls, raw, cwd, seenIds, index) {
  const at = `${cls}[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) reject(`${at} 须为对象`);
  const { id, argv, cwd: recipeCwd, timeoutMs, env, writePaths, inputPaths, outputs } = raw;
  if (typeof id !== "string" || !id.trim()) reject(`${at}.id 缺席或为空`);
  if (seenIds.has(id)) reject(`配方 id 重复：${id}（六类内全局唯一）`);
  seenIds.add(id);
  // argv 必须是字符串数组——单字符串（shell 串）是明确拒绝面：本模块的执行契约是
  // 「明确程序与 argv、shell:false」（主方案 §3.2），不生成任意命令串解释器。
  if (typeof argv === "string") reject(`${at}.argv 是字符串（${argv.slice(0, 40)}…）——argv 须为字符串数组（shell:false 执行面），不用 shell 串`);
  if (!Array.isArray(argv) || argv.length === 0) reject(`${at}.argv 须为非空字符串数组`);
  for (const a of argv) {
    if (typeof a !== "string" || !a.trim()) reject(`${at}.argv 含非字符串或空项`);
  }
  if (recipeCwd !== undefined && (typeof recipeCwd !== "string" || !recipeCwd.trim())) reject(`${at}.cwd 须为非空字符串`);
  // cwd 收容（M2，a1.r13 F-1）：与 writePaths/inputPaths 同族——绝对路径与根逃逸都拒，
  // 声明式检查命令不再能在项目根之外执行（相对语义随之稳定的家法一致性）。
  if (recipeCwd !== undefined) {
    if (isAbsolute(recipeCwd)) reject(`${at}.cwd 含绝对路径：「${recipeCwd}」——只收项目根相对路径（writePaths 家法）`);
    const resolvedCwd = resolve(cwd, recipeCwd);
    const relCwd = relative(cwd, resolvedCwd);
    if (relCwd.startsWith("..") || resolve(cwd, relCwd) !== resolvedCwd) {
      reject(`${at}.cwd 逃逸项目根：「${recipeCwd}」→ ${relCwd}`);
    }
  }
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) reject(`${at}.timeoutMs 须为正整数（毫秒）`);
  if (env !== undefined) {
    if (!Array.isArray(env)) reject(`${at}.env 须为变量名数组（只报名单，值运行时注入）`);
    for (const e of env) {
      if (typeof e !== "string" || !e.trim()) reject(`${at}.env 含非字符串或空项`);
      if (e.includes("=")) reject(`${at}.env 项带值：「${e.slice(0, 24)}」——清单只收变量名，凭据/值走运行环境注入`);
    }
  }
  if (writePaths !== undefined) {
    if (!Array.isArray(writePaths)) reject(`${at}.writePaths 须为相对路径数组`);
    for (const w of writePaths) {
      if (typeof w !== "string" || !w.trim()) reject(`${at}.writePaths 含非字符串或空项`);
      if (isAbsolute(w)) reject(`${at}.writePaths 含绝对路径：「${w}」——只收相对路径（越界由契约 scope 承担）`);
      const resolved = resolve(cwd, w);
      const rel = relative(cwd, resolved);
      if (rel.startsWith("..") || resolve(cwd, rel) !== resolved) {
        reject(`${at}.writePaths 逃逸项目根：「${w}」→ ${rel}`);
      }
    }
  }
  if (outputs !== undefined) {
    if (!Array.isArray(outputs)) reject(`${at}.outputs 须为字符串数组`);
    for (const o of outputs) {
      if (typeof o !== "string") reject(`${at}.outputs 含非字符串项`);
      // outputs 收容（M2，a1.r13 F-1）：同 writePaths 家法——outputs 会把 sha256 写进回执，
      // 绝对/逃逸条目等于把仓外任意路径（含设备文件等无界源）纳入回执工件面。
      if (isAbsolute(o)) reject(`${at}.outputs 含绝对路径：「${o}」——只收项目根相对路径（writePaths 家法）`);
      const resolvedOut = resolve(cwd, o);
      const relOut = relative(cwd, resolvedOut);
      if (relOut.startsWith("..") || resolve(cwd, relOut) !== resolvedOut) {
        reject(`${at}.outputs 逃逸项目根：「${o}」→ ${relOut}`);
      }
    }
  }
  // inputPaths（0.3.0 M2 范围档，ADR-0025）：该检查依赖的受验证输入清单——文件或目录条目，
  // 项目根相对；有清单且过对抗资格才允许回执复用（四问判定，core/verify.js）。校验同
  // writePaths 家法：相对路径、不逃逸项目根；条目可以是目录（执行时全枚举，未知新文件=变化）。
  if (inputPaths !== undefined) {
    if (!Array.isArray(inputPaths)) reject(`${at}.inputPaths 须为相对路径数组`);
    for (const w of inputPaths) {
      if (typeof w !== "string" || !w.trim()) reject(`${at}.inputPaths 含非字符串或空项`);
      if (isAbsolute(w)) reject(`${at}.inputPaths 含绝对路径：「${w}」——只收相对路径`);
      const resolved = resolve(cwd, w);
      const rel = relative(cwd, resolved);
      if (rel.startsWith("..") || resolve(cwd, rel) !== resolved) {
        reject(`${at}.inputPaths 逃逸项目根：「${w}」→ ${rel}`);
      }
    }
  }
  return { id, argv, cwd: recipeCwd ?? ".", timeoutMs: timeoutMs ?? null, env: env ?? [], writePaths: writePaths ?? [], inputPaths: inputPaths ?? [], outputs: outputs ?? [] };
}

export function validateManifest(obj, cwd) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) reject("顶层须为对象");
  if (obj.schemaVersion !== PROJECT_MANIFEST_VERSION) {
    reject(`schemaVersion 不识别：${obj.schemaVersion}（本 lzy 期望 ${PROJECT_MANIFEST_VERSION}）`);
  }
  if (!obj.capabilities || typeof obj.capabilities !== "object" || Array.isArray(obj.capabilities)) {
    reject("capabilities 缺席或非对象");
  }
  // ci 声明（0.4.0 M1，V10 面）：不是配方类，是必需 CI 检查集合声明——独立于六类配方，
  // 缺席=无 ci 义务（本地候选口径，如实不报可合并）；声明则 fail-closed 验形。
  // requiredChecks 须为非空唯一字符串数组：空声明比不声明更危险（制造「已声明但无事可验」
  // 的放行假象），直接拒。
  let ciDeclaration = null;
  for (const key of Object.keys(obj.capabilities)) {
    if (key === "ci") continue; // 形状校验在下方 validateCiDeclaration
    if (!CAPABILITY_CLASSES.includes(key)) {
      reject(`能力类不认识：「${key}」（合法：${CAPABILITY_CLASSES.join("/")}，另有可选声明 ci）`);
    }
  }
  if (obj.capabilities.ci !== undefined) {
    const ci = obj.capabilities.ci;
    if (!ci || typeof ci !== "object" || Array.isArray(ci)) reject("capabilities.ci 须为对象");
    const unknown = Object.keys(ci).filter((k) => k !== "requiredChecks");
    if (unknown.length > 0) reject(`capabilities.ci 有不认识的字段：「${unknown.join("、")}」（只收 requiredChecks）`);
    const rc = ci.requiredChecks;
    if (!Array.isArray(rc) || rc.length === 0) reject("capabilities.ci.requiredChecks 须为非空字符串数组——空声明制造放行假象，要免 CI 就删掉 ci 块");
    const seen = new Set();
    for (const id of rc) {
      if (typeof id !== "string" || !id.trim()) reject("capabilities.ci.requiredChecks 含非字符串或空项");
      if (seen.has(id)) reject(`capabilities.ci.requiredChecks 重复：「${id}」`);
      seen.add(id);
    }
    ciDeclaration = { requiredChecks: rc.map((s) => s.trim()) };
  }
  const seenIds = new Set();
  const capabilities = {};
  for (const cls of CAPABILITY_CLASSES) {
    const list = obj.capabilities[cls];
    if (list === undefined) {
      capabilities[cls] = [];
      continue;
    }
    if (!Array.isArray(list)) reject(`capabilities.${cls} 须为数组`);
    capabilities[cls] = list.map((r, i) => validateRecipe(cls, r, cwd, seenIds, i));
  }
  if (ciDeclaration) capabilities.ci = ciDeclaration;
  return { schemaVersion: PROJECT_MANIFEST_VERSION, capabilities };
}

// 入口存在性（就绪两态的静态半）：argv[0] 依次试 绝对路径 / 项目根相对 / PATH 扫描。
// 只判「存在」，不判可执行位/PATHEXT（win32 执行器细节归 M2 真实执行面）——本态命名
// 「entry-present」，与「actually-runnable」（M2 回执）严格分词，不冒充。
function entryPresent(argv0, cwd) {
  if (isAbsolute(argv0)) return existsSync(argv0);
  const asRepoPath = resolve(cwd, argv0);
  try {
    if (statSync(asRepoPath).isFile()) return true;
  } catch {}
  const dirs = (process.env.PATH ?? "").split(sep === "\\" ? ";" : ":").filter(Boolean);
  return dirs.some((d) => {
    try {
      return statSync(join(d, argv0)).isFile();
    } catch {
      return false;
    }
  });
}

const ENTRY_STATES = {
  PRESENT: "entry-present",
  ABSENT: "entry-missing",
};

// 就绪检查：清单在场且合法的前提下，逐配方报「入口存在」态。M1 不执行任何配方——
// 「实际可运行」是 M2 verify 的回执面，本命令如实只报静态半。
export function projectCheck(cwd) {
  const loaded = loadProjectManifest(cwd);
  if (!loaded) {
    return { present: false, hash: null, recipes: [] };
  }
  const recipes = [];
  for (const cls of CAPABILITY_CLASSES) {
    for (const r of loaded.manifest.capabilities[cls]) {
      const ok = entryPresent(r.argv[0], cwd);
      recipes.push({
        class: cls,
        id: r.id,
        state: ok ? ENTRY_STATES.PRESENT : ENTRY_STATES.ABSENT,
        entry: r.argv[0],
      });
    }
  }
  return { present: true, hash: loaded.hash, recipes };
}

// 只读发现（主方案 §3.2「列出缺失项」）：清单缺席=全类缺项+报告；在场=逐类数量+
// 入口缺失清单。产出是信息面，不是受信执行输入（信任流=契约引用哈希经批准）。
export function projectDiscover(cwd) {
  const p = projectManifestPath(cwd);
  const loaded = loadProjectManifest(cwd);
  if (!loaded) {
    return {
      present: false,
      missingClasses: [...CAPABILITY_CLASSES],
      absentEntries: [],
      hint: `无 ${p}——按六类能力起草后随仓库入库；采纳流=契约引用其哈希并经批准（ADR-0024）`,
    };
  }
  const missingClasses = CAPABILITY_CLASSES.filter((c) => loaded.manifest.capabilities[c].length === 0);
  const absentEntries = [];
  for (const cls of CAPABILITY_CLASSES) {
    for (const r of loaded.manifest.capabilities[cls]) {
      if (!entryPresent(r.argv[0], cwd)) absentEntries.push({ class: cls, id: r.id, entry: r.argv[0] });
    }
  }
  return { present: true, hash: loaded.hash, missingClasses, absentEntries, hint: null };
}
