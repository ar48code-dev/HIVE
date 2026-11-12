import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../hive-server/', import.meta.url)));
await import('../hive-server/dist/src/server.js');
