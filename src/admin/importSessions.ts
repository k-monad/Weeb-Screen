import type { ImportPreview } from "../importers/types.js";

const sessions = new Map<number, ImportPreview>();

export function storeImportPreview(jobId: number, preview: ImportPreview): void {
  sessions.set(jobId, preview);
}

export function getImportPreview(jobId: number): ImportPreview | null {
  return sessions.get(jobId) ?? null;
}

export function clearImportPreview(jobId: number): void {
  sessions.delete(jobId);
}

