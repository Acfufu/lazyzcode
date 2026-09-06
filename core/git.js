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
    // .lazyzcode/ 的循环状态文件不算（那是 lzy 自己的账本，不是被验证的代码）。
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
        .some((line) => line.trim() && !line.includes(".lazyzcode/"));
    },
  };
}
