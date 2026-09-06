// doctor 语法自检 worker：由 core/doctor.js 以全字面量 argv spawn（--experimental-vm-modules
// + 本文件路径 + 静态目录参数）。对目录内 .js 做 ESM 语法解析——vm.SourceTextModule 仅
// parse 不执行（不读 stdin、不写文件、无网络）；结果以 JSON 数组写 stdout。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const dirs = process.argv.slice(2);
const broken = [];
for (const dir of dirs) {
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
