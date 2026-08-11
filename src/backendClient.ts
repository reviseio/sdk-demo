import * as Y from "yjs";

/**
 * Client for the demo's backend service (`npm run server`).
 *
 * Every call ships the live Y.Doc's full state and merges the returned delta
 * back into it. Because both sides speak Yjs, the server's semantic edits —
 * including pending tracked suggestions — land in the open editor exactly as
 * a collaborator's would, even if the user kept typing during the round-trip.
 */

/** Transaction origin for server deltas, visible to transport code. */
export const BACKEND_ORIGIN = "revise-demo-backend";

const b64encode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const b64decode = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function post<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new Error(detail ?? `Backend responded ${response.status}`);
  }
  return (await response.json()) as T;
}

function snapshot(ydoc: Y.Doc): string {
  return b64encode(Y.encodeStateAsUpdate(ydoc));
}

function merge(ydoc: Y.Doc, update: string | undefined): void {
  if (update) Y.applyUpdate(ydoc, b64decode(update), BACKEND_ORIGIN);
}

export interface BackendStats {
  wordCount: number;
  totalBlocks: number;
  paragraphCount: number;
  characterCount: number;
  sections?: Array<{ title: string; wordCount: number }>;
}

export async function health(): Promise<boolean> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export interface ReviewResult {
  log: string[];
  suggestionIds: string[];
  stats: BackendStats;
}

export async function runReviewPass(
  ydoc: Y.Doc,
  documentId: string,
): Promise<ReviewResult> {
  const result = await post<ReviewResult & { update?: string }>("/api/review", {
    update: snapshot(ydoc),
    documentId,
  });
  merge(ydoc, result.update);
  return result;
}

export interface ReplaceResult {
  mode: "editing" | "suggesting";
  replacedBlocks: number;
  suggestionIds: string[];
}

export async function runReplace(
  ydoc: Y.Doc,
  documentId: string,
  find: string,
  replace: string,
  mode: "editing" | "suggesting",
): Promise<ReplaceResult> {
  const result = await post<ReplaceResult & { update?: string }>(
    "/api/replace",
    { update: snapshot(ydoc), documentId, find, replace, mode },
  );
  merge(ydoc, result.update);
  return result;
}

export async function fetchStats(
  ydoc: Y.Doc,
  documentId: string,
): Promise<BackendStats> {
  const result = await post<{ stats: BackendStats }>("/api/measure", {
    update: snapshot(ydoc),
    documentId,
  });
  return result.stats;
}

export async function exportViaServer(
  ydoc: Y.Doc,
  title: string,
): Promise<void> {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ update: snapshot(ydoc) }),
  });
  if (!response.ok) throw new Error(`Backend responded ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title} (server export).docx`;
  link.click();
  URL.revokeObjectURL(url);
}
