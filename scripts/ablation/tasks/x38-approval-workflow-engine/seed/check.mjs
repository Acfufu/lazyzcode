import { createWorkflow } from "./src/workflow.mjs";
let bad = 0;
const wf = createWorkflow({ author: "ann" });
wf.transit("submit", "ann");
if (wf.state !== "in_review") { console.error("FAIL submit"); bad++; }
wf.transit("approve", "bob");
if (wf.state !== "approved") { console.error("FAIL approve"); bad++; }
let threw = false;
try { wf.transit("approve", "bob"); } catch { threw = true; }
if (!threw) { console.error("FAIL illegal from approved"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
