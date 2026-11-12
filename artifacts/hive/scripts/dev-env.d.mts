export function hiveDevServerEnv(env: NodeJS.ProcessEnv): {
  DATABASE_URL: string;
  DEMO_MODE: 'true' | 'false';
};
