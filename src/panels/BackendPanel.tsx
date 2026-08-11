import { useCallback, useEffect, useState } from "react";
import type { ReviseEditorHandle } from "@reviseio/sdk";
import type { Doc as YDoc } from "yjs";

import {
  exportViaServer,
  fetchStats,
  health,
  runReplace,
  runReviewPass,
  type BackendStats,
  type ReviewResult,
} from "../backendClient";

/**
 * The server half of the demo: the same document this tab is editing, round-
 * tripped through a Node service built on `@reviseio/sdk/backend`.
 *
 * The client posts its live Y.Doc; the server runs the canonical semantic
 * tools against it headlessly and answers with a CRDT delta. Suggesting-mode
 * edits arrive as pending tracked changes — the response carries their IDs,
 * so this panel can accept or reject exactly the batch the server proposed,
 * while the Changes panel shows them individually like any collaborator's.
 */
export function BackendPanel({
  handle,
  ydoc,
  documentId,
  onNotice,
}: {
  handle: ReviseEditorHandle | null;
  ydoc: YDoc | null;
  documentId: string | null;
  onNotice: (message: string) => void;
}) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stats, setStats] = useState<BackendStats | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [replaceMode, setReplaceMode] = useState<"suggesting" | "editing">(
    "suggesting",
  );

  const checkHealth = useCallback(async () => {
    setOnline(await health());
  }, []);

  useEffect(() => {
    void checkHealth();
    const interval = window.setInterval(() => void checkHealth(), 5000);
    return () => window.clearInterval(interval);
  }, [checkHealth]);

  const guard = async (label: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try {
      await work();
    } catch (error) {
      onNotice(
        error instanceof Error ? `Backend: ${error.message}` : "Backend error",
      );
      void checkHealth();
    } finally {
      setBusy(null);
    }
  };

  if (online === false) {
    return (
      <div className="empty">
        <p>Backend service is offline.</p>
        <p className="hint">
          This panel talks to a local Node service built on{" "}
          <code>@reviseio/sdk/backend</code> — the same semantic tools, run
          server-side against this very document. Start it in a second
          terminal:
        </p>
        <p className="hint">
          <code>npm run server</code>
        </p>
        <p className="hint">
          (On the static GitHub Pages deployment there is no server; run the
          demo locally to see this half.)
        </p>
        <div className="panel-head-actions" style={{ padding: 12 }}>
          <button onClick={() => void checkHealth()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!ydoc || !documentId) {
    return (
      <div className="empty">
        <p>No shared document in this tab.</p>
        <p className="hint">
          The backend works on the collaborative sample document. Switch to the
          first tab (or reload with collaboration enabled) to round-trip it
          through the server.
        </p>
      </div>
    );
  }

  const reviewIds = review?.suggestionIds ?? [];
  const resolveBatch = (accept: boolean) => {
    if (!handle || reviewIds.length === 0) return;
    const decision = accept
      ? handle.review.acceptSuggestions(reviewIds)
      : handle.review.rejectSuggestions(reviewIds);
    const count = decision.resolved.length;
    onNotice(
      `${accept ? "Accepted" : "Rejected"} ${count} server suggestion${count === 1 ? "" : "s"} by ID` +
        (decision.missing.length > 0
          ? ` (${decision.missing.length} already settled)`
          : ""),
    );
    setReview(null);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span>
          {online === null ? "Checking backend…" : "Backend online :8787"}
        </span>
        <div className="panel-head-actions">
          <button
            disabled={!!busy}
            onClick={() =>
              void guard("stats", async () => {
                setStats(await fetchStats(ydoc, documentId));
              })
            }
          >
            {busy === "stats" ? "Measuring…" : "Measure"}
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              void guard("export", async () => {
                await exportViaServer(ydoc, handle?.document().title ?? "document");
                onNotice("Server rendered this document to .docx");
              })
            }
          >
            {busy === "export" ? "Exporting…" : "Server export"}
          </button>
        </div>
      </div>

      <p className="hint pad">
        Each action posts this tab&rsquo;s live document to the Node service,
        which runs the SDK&rsquo;s semantic tools headlessly and answers with a
        CRDT delta — merged straight back into the open editor.
      </p>

      {stats ? (
        <div className="backend-stats">
          <span>
            <strong>{stats.wordCount}</strong> words
          </span>
          <span>
            <strong>{stats.totalBlocks}</strong> blocks
          </span>
          <span>
            <strong>{stats.paragraphCount}</strong> paragraphs
          </span>
          {stats.sections?.length ? (
            <span>
              <strong>{stats.sections.length}</strong> sections
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="backend-section">
        <div className="panel-head">
          <span>Server review pass</span>
          <button
            disabled={!!busy}
            onClick={() =>
              void guard("review", async () => {
                const result = await runReviewPass(ydoc, documentId);
                setReview(result);
                onNotice(
                  result.suggestionIds.length > 0
                    ? `Server proposed ${result.suggestionIds.length} tracked change${result.suggestionIds.length === 1 ? "" : "s"} — see the Changes panel`
                    : "Server review found nothing to suggest",
                );
              })
            }
          >
            {busy === "review" ? "Reviewing…" : "Run review"}
          </button>
        </div>
        <p className="hint pad">
          A canned &ldquo;counsel pass&rdquo;: tighten wordy phrasing as
          tracked suggestions and comment on the longest paragraph — all
          proposed server-side, reviewable here.
        </p>
        {review ? (
          <div className="backend-log">
            {review.log.map((line, index) => (
              <code key={index}>{line}</code>
            ))}
            {reviewIds.length > 0 ? (
              <div className="panel-head-actions">
                <button onClick={() => resolveBatch(true)}>
                  Accept these {reviewIds.length}
                </button>
                <button onClick={() => resolveBatch(false)}>
                  Reject these {reviewIds.length}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="backend-section">
        <div className="panel-head">
          <span>Server find &amp; replace</span>
        </div>
        <div className="backend-form">
          <input
            placeholder="find"
            value={find}
            onChange={(event) => setFind(event.target.value)}
          />
          <input
            placeholder="replace with"
            value={replace}
            onChange={(event) => setReplace(event.target.value)}
          />
          <select
            value={replaceMode}
            onChange={(event) =>
              setReplaceMode(event.target.value as "suggesting" | "editing")
            }
          >
            <option value="suggesting">as suggestions</option>
            <option value="editing">apply directly</option>
          </select>
          <button
            disabled={!!busy || !find}
            onClick={() =>
              void guard("replace", async () => {
                const result = await runReplace(
                  ydoc,
                  documentId,
                  find,
                  replace,
                  replaceMode,
                );
                onNotice(
                  result.replacedBlocks === 0
                    ? `"${find}" not found`
                    : result.mode === "suggesting"
                      ? `Server suggested changes in ${result.replacedBlocks} block${result.replacedBlocks === 1 ? "" : "s"} (${result.suggestionIds.length} record${result.suggestionIds.length === 1 ? "" : "s"})`
                      : `Server replaced across ${result.replacedBlocks} block${result.replacedBlocks === 1 ? "" : "s"} directly`,
                );
              })
            }
          >
            {busy === "replace" ? "Running…" : "Run"}
          </button>
        </div>
        <p className="hint pad">
          The same edit, two postures: <em>as suggestions</em> creates pending
          tracked changes; <em>apply directly</em> lands immediately — exactly
          the editing/suggesting split a service chooses per workflow.
        </p>
      </div>
    </div>
  );
}
