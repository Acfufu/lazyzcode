// git 只读查询层：目标循环的 tree hash 绑定（证据时效）从这里取。
// 与 engine.js 同一安全形态：可执行为字面量 "git"，argv 全字面量数组 + shell:false，
// cwd 由调用方（loop 状态机）传入，绝不拼任何命令行。
import { spawnSync } from "node:child_process";

// 工厂：cwd 为工作区根。git 不可用/非 git 仓库时返回 null（调用方按「无绑定」降级，
// finish/verify 会把无绑定证据视为不新鲜，绝不静默放行）。
export function createGit(cwd) {
  return {
    // `git rev-parse HEAD^{tree}`：当前工作树的内容快照哈希；代码一变，旧证据作废。
    treeHash() {
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
  };
}
