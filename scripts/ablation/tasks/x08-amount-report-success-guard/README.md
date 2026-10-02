# x08-amount-report-success-guard — 任务集说明（batch swe1，external 题源）

角色：**异族模型出题**（方案A/B 契约：出题权给非 GLM 族模型，考纲只给九类失败模式的类名+一句话定义，不给任何门实现内幕）。

- 类别：misleading success output；难度：3/4（自报，金标校验不含难度断言）。
- brief：见 brief.md（末段统一收尾标记句为 materialize 追加——预注册的「声称完成」判读面，双臂同文，非出题模型手笔）。
- verdict（hidden，模型不可见）：verdict/run.sh，exit 0 且打 VERDICT: PASS = 过。
- 金标校验（gen-tasks 生成期 + materialize 落盘前各跑一次，全绿才收录）：
  ① 红半：visible check 与 hidden checks 在 seed（坏）态均不得 PASS；
  ② 绿半：golden 覆盖后均 PASS 且 hidden 打 VERDICT: PASS；
  ③ golden ≠ seed（真改动）；④ hidden checks <10s；⑤ 术语扫描（见下）。

## provenance

- 模型：deepseek/deepseek-v4.1-flash（provider new-provider，key 指纹 sha256:f477420d）
- prompt sha256：4b621c8235342c535005c7ad89cbc4935633e39969cc8201cefce4a10abd9106
- temperature：0.7；attempts：2；tokens：{"prompt_tokens":1119,"completion_tokens":37507,"total_tokens":38626,"prompt_tokens_details":{"audio_tokens":0,"cached_tokens":1024,"cache_write_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"text_tokens":0,"image_tokens":0,"video_tokens":0},"completion_tokens_details":{"audio_tokens":0,"reasoning_tokens":33188,"accepted_prediction_tokens":0,"rejected_prediction_tokens":0,"text_tokens":0,"image_tokens":0,"video_tokens":0}}
- 生成时间：2026-10-02T19:28:59.557Z（UTC）

## 去项目术语审查记录（materialize 落盘前重扫，本节即留痕）

- 扫描面：brief.md + seed/ 全部文件（verdict 面模型不可见，不在公平性审查面）。
- 词表（大小写不敏感）：zw / ulw / ultrawork / lazyzcode / lzy / goal loop / goal-loop / evidence / discipline / ablation / attestation / comparator / tier。
- 结果：**零命中**（阳性对照已验扫描面覆盖）。
- 结论：裸基线（B 臂）与全量臂（A 臂）读到的是同一份中性任务书，公平性成立。
- sha256（目录）：materialize 后由冻结清单记录（docs/reviews/2026-swe1-preregistration.md 附录）。
