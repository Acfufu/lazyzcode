// Node 下限前置探测契约（债六，0.1.1）：assertNodeFloor 纯函数注入式断言。
// floor 常量单源 core/doctor.js NODE_MAJOR_FLOOR（installer 不复制——doctor↔installer
// 反向 import 成环，故由调用点传参；cli/lzy.js cmdInstall/cmdSync 接线为集成面）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

test("assertNodeFloor：floor 超当前版本即拒，报文含当前版本与升级指路", async () => {
  const { assertNodeFloor } = await import(pathToFileURL(join(ROOT, "core", "installer.js")).href);
  try {
    assertNodeFloor(999);
    assert.fail("floor=999 应拒绝");
  } catch (e) {
    assert.match(e.message, /Node >= 999/);
    assert.match(e.message, new RegExp(process.versions.node.split(".")[0])); // 当前主版本在报文内
    assert.match(e.message, /nvm install 999/); // 升级指路（恢复式报错家法）
  }
});

test("assertNodeFloor：floor=0 放行不抛；NODE_MAJOR_FLOOR 单源常量在位（=22）", async () => {
  const { assertNodeFloor } = await import(pathToFileURL(join(ROOT, "core", "installer.js")).href);
  const { NODE_MAJOR_FLOOR } = await import(pathToFileURL(join(ROOT, "core", "doctor.js")).href);
  assert.doesNotThrow(() => assertNodeFloor(0));
  assert.equal(NODE_MAJOR_FLOOR, 22);
});
