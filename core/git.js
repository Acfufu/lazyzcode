// git 只读查询层：目标循环的 tree hash 绑定（证据时效）从这里取。
// 与 engine.js 同一安全形态：可执行为字面量 "git"，argv 全字面量数组 + shell:false，
// cwd 由调用方（loop 状态机）传入，绝不拼任何命令行。
import { spawnSync } from "node:child_process";

// 工厂：cwd 为工作区根。git 不可用/非 git 仓库时返回 null（调用方按「无绑定」降级，
// finish/verify 会把无绑定证据视为不新鲜，绝不静默放行）。
export function createGit(cwd) {
  return {
    // `git rev-parse HEAD^{tree}`：HEAD 头树哈希（已提交内容快照），非「工作树快照」——
    // 未提交改动不在哈希内，代码一变（提交后）旧证据作废。多树=每根一 createGit(root) 实例。
    headTreeHash() {
      const r = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
        cwd,
        shell: false,
        timeout: 10_000,
        encoding: "utf8",
      });
      if (r.error || r.status !== 0) return null;
      const out = (r.stdout ?? "").trim();
      return /^[0-9a-f]{40,64}$/.test(out) ? out : null;
    },
    // deprecated 别名（v008-integrity-kernel#N2 正名遗留）：一版后删，新代码一律 headTreeHash()。
    treeHash() {
      return this.headTreeHash();
    },
    // 工作区有未提交改动时为 true（证据应跟随提交：先提交再取证，否则证据可辩驳）。
    // 只排除 .lazyzcode/ 自身的账本：精确路径判定，含该子串的其他路径（如 backup.lazyzcode/）照常报警（评审 R2-2）。
    // 提交账本巡逻（ADR-0005）：goal 起点后的提交总数与缺 `Goal:` 尾注数。
    // since 时间戳作为单个 argv 元素传递，绝不拼接命令行（安全形态同上）。
    // git 不可用/非 git 仓库时返回 null（调用方按 skip 降级）。
    goalLedger(sinceIso) {
      const r = spawnSync(
        "git",
        ["log", `--since=${sinceIso}`, "--format=%x1e%H%x1f%B"],
        { cwd, shell: false, timeout: 10_000, encoding: "utf8" },
      );
      if (r.error || r.status !== 0) return null;
      const entries = (r.stdout ?? "").split("\x1e").filter((chunk) => chunk.trim());
      let total = 0;
      let missing = 0;
      for (const entry of entries) {
        const body = entry.slice(entry.indexOf("\x1f") + 1);
        total += 1;
        if (!/^Goal: \S/m.test(body)) missing += 1;
      }
      return { total, missing };
    },
    dirty() {
      const r = spawnSync("git", ["status", "--porcelain"], {
        cwd,
        shell: false,
        timeout: 10_000,
        encoding: "utf8",
      });
      if (r.error || r.status !== 0) return false;
      return (r.stdout ?? "")
        .split(/\r?\n/)
        .some((line) => {
          const raw = line.slice(3).trim(); // porcelain v1：XY<空格>path
          if (!raw) return false;
          const renamed = raw.includes(" -> ") ? raw.split(" -> ").pop() : raw;
          const p = renamed.replace(/^"(.*)"$/, "$1"); // git 对特殊字符路径加引号
          return p !== ".lazyzcode" && !p.startsWith(".lazyzcode/");
        });
    },
    // 可回收工件盘点（C 面）：porcelain 路径清单（口径同 dirty()，排除 .lazyzcode/ 自身账本）。
    // git 不可用/非 git 仓库时返回 null（调用方降级：存根只留资产指针，不阻断销毁）。
    porcelainPaths() {
      const r = spawnSync("git", ["status", "--porcelain"], {
        cwd,
        shell: false,
        timeout: 10_000,
        encoding: "utf8",
      });
      if (r.error || r.status !== 0) return null;
      return (r.stdout ?? "")
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => {
          const raw = line.slice(3).trim();
          const renamed = raw.includes(" -> ") ? raw.split(" -> ").pop() : raw;
          return renamed.replace(/^"(.*)"$/, "$1");
        })
        .filter((p) => p !== ".lazyzcode" && !p.startsWith(".lazyzcode/"));
    },
    // 按提交账本尾注标记列提交（ADR-0005 读面）：--grep 标记为单 argv 元素（安全形态同上）。
    // 返回 "<short-hash> <subject>" 数组；git 不可用/非 git 仓库时返回 null。
    commitSubjects(grepMarker) {
      const r = spawnSync(
        "git",
        ["log", `--grep=${grepMarker}`, "--format=%h %s"],
        { cwd, shell: false, timeout: 10_000, encoding: "utf8" },
      );
      if (r.error || r.status !== 0) return null;
      return (r.stdout ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    },
    // 全期尾注按 slug 聚合（pisper-absorption#N4 谱系读面）：全 history 扫描，
    // 区别于 goalLedger 的 --since 有界。尾注须正文独立行（ADR-0005 铁律），
    // /^Goal: <slug>#/m 提取；返回 Map：slug → { commits, lastAt(committer ISO 或 null) }。
    // git 不可用/非 git 仓库时返回 null（调用方按「无 git 面」降级）。
    trailersBySlug() {
      const r = spawnSync("git", ["log", "--format=%x1e%cI%x1f%B"], {
        cwd,
        shell: false,
        timeout: 10_000,
        encoding: "utf8",
      });
      if (r.error || r.status !== 0) return null;
      const bySlug = new Map();
      const entries = (r.stdout ?? "").split("\x1e").filter((chunk) => chunk.trim());
      for (const entry of entries) {
        const nl = entry.indexOf("\x1f");
        const date = entry.slice(0, nl).trim();
        const body = entry.slice(nl + 1);
        const m = body.match(/^Goal: (\S+?)#\S*$/m);
        if (!m) continue;
        const prev = bySlug.get(m[1]) ?? { commits: 0, lastAt: null };
        prev.commits += 1;
        if (date && (!prev.lastAt || date > prev.lastAt)) prev.lastAt = date;
        bySlug.set(m[1], prev);
      }
      return bySlug;
    },
    // 项目记忆过期指纹（memory-staleness-fingerprint#N1）：地图滞后数 lag = 根 AGENTS.md
    // 最后一次提交（基点，--full-history 防 TREESAME 合并吞掉侧支改动）之后，覆盖目录集
    // paths 上的新提交个数。地图再被提交会自然抬高基点 = 重置计数（重跑 init-deep 即清零）。
    // 唯一构造面：基点 hash 经 /^[0-9a-f]{40,64}$/ 校验后才拼 `<hash>..HEAD` 范围参数
    // （goalLedger 的 --since= 构造为先例）；paths 逐个作 argv 元素传递，绝不拼命令行。
    // git 不可用/非 git 仓/无地图提交史/paths 空/解析失败 → null（数据沉默=无提示）。
    mapLag(paths) {
      if (!Array.isArray(paths) || paths.length === 0) return null;
      const base = spawnSync(
        "git",
        ["log", "-1", "--full-history", "--format=%H", "--", "AGENTS.md"],
        { cwd, shell: false, timeout: 10_000, encoding: "utf8" },
      );
      const commit = (base.stdout ?? "").trim();
      if (base.error || base.status !== 0 || !/^[0-9a-f]{40,64}$/.test(commit)) return null;
      const r = spawnSync(
        "git",
        ["rev-list", "--count", `${commit}..HEAD`, "--", ...paths],
        { cwd, shell: false, timeout: 10_000, encoding: "utf8" },
      );
      if (r.error || r.status !== 0) return null;
      const n = Number.parseInt((r.stdout ?? "").trim(), 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    },
  };
}
