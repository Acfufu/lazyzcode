import { readFile } from 'node:fs/promises';

const FALLBACK_TIMEOUT_MS = 2000;

function positiveInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export async function loadManifest(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`cannot read manifest: ${path}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('manifest is not valid JSON');
  }

  if (data === null || typeof data !== 'object' || !Array.isArray(data.tasks)) {
    throw new Error('manifest must be an object with a tasks array');
  }

  const defaultTimeoutMs = positiveInt(data.defaultTimeoutMs) ?? FALLBACK_TIMEOUT_MS;

  const tasks = data.tasks.map((task, index) => {
    if (task === null || typeof task !== 'object') {
      throw new Error(`task ${index} is not an object`);
    }
    if (typeof task.name !== 'string' || task.name === '') {
      throw new Error(`task ${index} has no name`);
    }
    if (typeof task.command !== 'string' || task.command === '') {
      throw new Error(`task ${task.name} has no command`);
    }
    const args = task.args === undefined ? [] : task.args;
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new Error(`task ${task.name} has invalid args`);
    }
    return {
      name: task.name,
      command: task.command,
      args,
      timeoutMs: positiveInt(task.timeoutMs) ?? defaultTimeoutMs,
    };
  });

  return { tasks };
}
