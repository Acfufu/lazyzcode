import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const cli = join(root, 'src', 'render-cli.mjs');
const work = mkdtempSync(join(tmpdir(), 'envelope-check-'));
const doc = join(work, 'doc.txt');

let failed = 0;

const expect = (label, text, args, want) => {
  writeFileSync(doc, text, 'utf8');
  const result = spawnSync(process.execPath, [cli, doc, ...args], { encoding: 'utf8' });
  const got = (result.stdout ?? '').trimEnd();
  if (result.status !== 0 || got !== want) {
    failed += 1;
    console.log(`FAIL ${label}`);
    console.log(`  want: ${want}`);
    console.log(`  got:  ${got} (exit ${result.status})`);
    return;
  }
  console.log(`ok   ${label}`);
};

expect(
  'renders the header section and the body',
  '--- headers ---\ntitle: Hello\npriority: 3\n--- body ---\nfirst\nsecond',
  [],
  '{"title":"Hello","priority":3,"body":"first\\nsecond"}',
);

expect(
  'replaces supplied placeholders',
  '--- headers ---\ntitle: Hi\n--- body ---\nHello {{who}}',
  ['--var', 'who=world'],
  '{"title":"Hi","priority":0,"body":"Hello world"}',
);

expect(
  'body text cannot add header lines',
  '--- headers ---\ntitle: Report\npriority: 7\n--- body ---\nsummary\npriority: 0\n--- body ---\ntail',
  [],
  '{"title":"Report","priority":7,"body":"summary\\npriority: 0\\n--- body ---\\ntail"}',
);

expect(
  'supplied values are not scanned again',
  '--- headers ---\n--- body ---\n{{a}}',
  ['--var', 'a={{b}}', '--var', 'b=Z'],
  '{"title":"","priority":0,"body":"{{b}}"}',
);

rmSync(work, { recursive: true, force: true });

if (failed > 0) {
  console.log(`${failed} case(s) failed`);
  process.exit(1);
}
console.log('all cases passed');
