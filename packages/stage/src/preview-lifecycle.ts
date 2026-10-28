import type { Runner } from "./runner.js";

// Internal coordination: browser preview and render hosts may share a runner.
// Export must own its frame context, even when the preview's RAF is suspended.
interface PreviewLifecycle { stop(): Promise<void>; finish(): void; }
const previews = new WeakMap<Runner, Set<PreviewLifecycle>>();

export function registerPreview(runner: Runner, stop: () => Promise<void>, finish: () => void): () => void {
  const lifecycle = { stop, finish };
  const hosts = previews.get(runner) ?? new Set<PreviewLifecycle>();
  hosts.add(lifecycle);
  previews.set(runner, hosts);
  return () => {
    hosts.delete(lifecycle);
    if (hosts.size === 0) previews.delete(runner);
  };
}

export async function stopPreviewForExport(runner: Runner): Promise<void> {
  await Promise.all([...(previews.get(runner) ?? [])].map(host => host.stop()));
}

export function finishPreviewExport(runner: Runner): void {
  for (const host of previews.get(runner) ?? []) host.finish();
}
