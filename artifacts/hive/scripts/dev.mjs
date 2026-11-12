import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hiveDevServerEnv } from './dev-env.mjs';

const apiPort = process.env.HIVE_API_PORT ?? '23028';
let serverEnv;
try {
  serverEnv = {
    ...process.env,
    ...hiveDevServerEnv(process.env),
    PORT: apiPort,
  };
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
const serverDir = fileURLToPath(new URL('../hive-server/', import.meta.url));
const tsxBin = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

const children = [
  spawn(tsxBin, ['src/server.ts'], {
    cwd: serverDir,
    env: serverEnv,
    stdio: 'inherit',
  }),
  spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '0.0.0.0'], {
    env: process.env,
    stdio: 'inherit',
  }),
];

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    stop('SIGTERM');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (!stopping && code !== 0) {
      process.exitCode = code ?? 1;
      stop('SIGTERM');
    }
  });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
