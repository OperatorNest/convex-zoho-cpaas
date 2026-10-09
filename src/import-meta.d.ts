export type ImportMetaGlob = ImportMeta["glob"];

declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string): Record<string, () => Promise<T>>;
  }
}
