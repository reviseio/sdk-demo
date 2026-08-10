import type {
  ReviseDocumentRole,
  ReviseEditorHandle,
  ReviseReviewState,
  ReviseTrackedChange,
} from "@reviseio/sdk";

/**
 * A Word-style review panel, built entirely from `review.listChanges()`. This
 * is the thing an embedder cannot build from IDs alone: who changed what,
 * when, and what the text actually says.
 */
export function ChangesPanel({
  handle,
  changes,
  review,
  role,
  onRefuse,
}: {
  handle: ReviseEditorHandle | null;
  changes: ReviseTrackedChange[];
  review: ReviseReviewState | null;
  role: ReviseDocumentRole;
  onRefuse: (error: unknown) => void;
}) {
  const canResolve = role === "editor";

  const resolve = (change: ReviseTrackedChange, accept: boolean) => {
    if (!handle) return;
    try {
      const applied = accept
        ? handle.review.acceptSuggestions([change.id])
        : handle.review.rejectSuggestions([change.id]);
      if (applied === 0) {
        onRefuse(
          `A "${role}" may not ${accept ? "accept" : "reject"} tracked changes`,
        );
      }
    } catch (error) {
      onRefuse(error);
    }
  };

  if (!changes.length) {
    return (
      <div className="empty">
        <p>No pending changes.</p>
        <p className="hint">
          Switch the toolbar to <em>Suggesting</em> and type — every edit is
          recorded as a tracked change and appears here with its author.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>
          {changes.length} pending {changes.length === 1 ? "change" : "changes"}
        </span>
        <div className="panel-head-actions">
          <button
            disabled={!canResolve}
            onClick={() => handle?.review.acceptAll()}
            title={canResolve ? "Accept every change" : "Not permitted by role"}
          >
            Accept all
          </button>
          <button
            disabled={!canResolve}
            onClick={() => handle?.review.rejectAll()}
            title={canResolve ? "Reject every change" : "Not permitted by role"}
          >
            Reject all
          </button>
        </div>
      </div>

      <ul className="changes">
        {changes.map((change) => {
          const current = review?.currentSuggestionIds.includes(change.id);
          return (
            <li
              key={change.id}
              className={current ? "change current" : "change"}
              onClick={() => handle?.review.navigateToSuggestion(change.id)}
              onMouseEnter={() =>
                handle?.review.previewSuggestions([change.id], "accept")
              }
              onMouseLeave={() =>
                handle?.review.previewSuggestions([change.id], null)
              }
            >
              <div className="change-head">
                <span className={`kind ${change.kind}`}>{change.kind}</span>
                <strong>{change.author}</strong>
                {change.authorType === "ai" ? (
                  <span className="ai" title={change.agentModel}>
                    AI
                  </span>
                ) : null}
                {change.createdAt ? (
                  <time>
                    {new Date(change.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                ) : null}
              </div>

              <div className="change-body">
                {change.kind === "move" ? (
                  // One card per linked move: the same text left one place
                  // and arrived in another, so show it once.
                  <ins>{truncate(change.insertedText ?? change.deletedText ?? "")}</ins>
                ) : (
                  <>
                    {change.deletedText ? (
                      <del>{truncate(change.deletedText)}</del>
                    ) : null}
                    {change.insertedText ? (
                      <ins>{truncate(change.insertedText)}</ins>
                    ) : null}
                    {!change.deletedText && !change.insertedText ? (
                      <span className="hint">
                        {change.description ?? "Formatting change"}
                      </span>
                    ) : null}
                  </>
                )}
              </div>

              <div className="change-actions">
                <span className="where">{describeLocation(change)}</span>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    resolve(change, true);
                  }}
                >
                  Accept
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    resolve(change, false);
                  }}
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="panel-foot">
        <button onClick={() => handle?.review.previous()}>← Previous</button>
        <button onClick={() => handle?.review.next()}>Next →</button>
        <select
          value={review?.viewMode ?? "all-markup"}
          onChange={(event) =>
            handle?.review.setSuggestionViewMode(
              event.target.value as "all-markup" | "final" | "original",
            )
          }
        >
          <option value="all-markup">All markup</option>
          <option value="final">Final</option>
          <option value="original">Original</option>
        </select>
      </div>
    </div>
  );
}

function truncate(text: string): string {
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function describeBlocks(blockIds: string[]): string {
  if (!blockIds.length) return "?";
  return `${blockIds[0]}${blockIds.length > 1 ? ` +${blockIds.length - 1}` : ""}`;
}

function describeLocation(change: ReviseTrackedChange): string {
  if (change.kind === "move") {
    return `block ${describeBlocks(change.moveSourceBlockIds ?? [])} → ${describeBlocks(
      change.moveDestinationBlockIds ?? [],
    )}`;
  }
  return change.blockIds.length
    ? `block ${describeBlocks(change.blockIds)}`
    : "structural";
}
