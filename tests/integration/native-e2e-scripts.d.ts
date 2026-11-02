/** Public launcher/build helpers consumed by the native integration fixture. */
declare module '*scripts/build.mjs' {
  export function buildProject(options?: { root?: string; outDir?: string; hostEntry?: string; clientEntry?: string }): Promise<{
    schemaVersion: string; sourceSha: string; sourceDirty: boolean; superagentSha: string; builtAt: string;
    artifacts: { path: string; bytes: number; sha256: string }[];
  }>;
}
declare module '*scripts/start.mjs' {
  export function loadSettings(home: string, env?: NodeJS.ProcessEnv): {
    project: string; password: string; port: number; modelAccount: 'test' | 'runtime'; settingsPath: string;
  };
  export function start(options?: {
    env?: NodeJS.ProcessEnv; root?: string; stdout?: (text: string) => void; stderr?: (text: string) => void;
    spawn?: (command: string, args: string[], options: import('node:child_process').SpawnOptions) =>
      Pick<import('node:child_process').ChildProcess, 'stdout' | 'stderr' | 'once' | 'kill'>;
  }): { child: Pick<import('node:child_process').ChildProcess, 'stdout' | 'stderr' | 'once' | 'kill'>;
    home: string; port: number; cleanup(): void };
  export function scrubEnvironment(env: NodeJS.ProcessEnv, home: string, apiKey?: string): NodeJS.ProcessEnv & { DSH_HOME:string };
  export function lineWriter(write: (text: string) => void, secrets?: string[]): { push(text: string): void; flush(): void };
}
