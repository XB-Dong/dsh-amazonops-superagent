/** Public launcher/build helpers consumed by the native integration fixture. */
declare module '*scripts/build.mjs' {
  export function buildProject(options?: { root?: string; outDir?: string; hostEntry?: string; clientEntry?: string }): Promise<{
    schemaVersion: string; sourceSha: string; sourceDirty: boolean; superagentSha: string; builtAt: string;
    artifacts: { path: string; bytes: number; sha256: string }[];
  }>;
}
declare module '*scripts/start.mjs' {
  export function scrubEnvironment(env: NodeJS.ProcessEnv, home: string, apiKey?: string): NodeJS.ProcessEnv;
  export function lineWriter(write: (text: string) => void, secrets?: string[]): { push(text: string): void; flush(): void };
}
