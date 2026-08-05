import { useState } from "react";
import type {
  ReviseDocumentRole,
  ReviseEditorHandle,
  ReviseReviewState,
} from "@reviseio/sdk";

/** Comment threads read from review state and written through the same
 * controller — including replies and resolution. */
export function CommentsPanel({
  handle,
  review,
  role,
}: {
  handle: ReviseEditorHandle | null;
  review: ReviseReviewState | null;
  role: ReviseDocumentRole;
}) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const threads = review?.commentThreads ?? [];
  const canComment = role !== "viewer";

  const addAtSelection = () => {
    if (!handle || !draft.trim()) return;
    const id = handle.review.addCommentAtSelection(draft.trim());
    setDraft("");
    if (!id) {
      // The API answers null when there is nothing to anchor to.
      window.alert("Select some text in the document first.");
    }
  };

  return (
    <div className="panel">
      <div className="composer">
        <textarea
          placeholder={
            canComment
              ? "Comment on the current selection…"
              : "Viewers cannot comment"
          }
          value={draft}
          disabled={!canComment}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button disabled={!canComment || !draft.trim()} onClick={addAtSelection}>
          Comment on selection
        </button>
      </div>

      {threads.length === 0 ? (
        <div className="empty">
          <p>No comment threads.</p>
          <p className="hint">
            Select a phrase in the document and comment on it — or use the chip
            that appears in the page margin.
          </p>
        </div>
      ) : (
        <ul className="threads">
          {threads.map((thread) => (
            <li
              key={thread.root.id}
              className={
                review?.activeCommentId === thread.root.id
                  ? "thread active"
                  : "thread"
              }
              onClick={() => handle?.review.selectComment(thread.root.id)}
            >
              <div className="thread-head">
                <strong>{thread.root.author ?? "Anonymous"}</strong>
                {thread.root.resolved ? (
                  <span className="resolved">resolved</span>
                ) : null}
              </div>
              <p>{thread.root.bodyMd}</p>

              {thread.replies.map((reply) => (
                <p key={reply.id} className="reply">
                  <strong>{reply.author ?? "Anonymous"}:</strong> {reply.bodyMd}
                </p>
              ))}

              {thread.relatedSuggestionIds.length > 0 ? (
                <div className="thread-actions">
                  <span className="hint">
                    {thread.relatedSuggestionIds.length} related change
                    {thread.relatedSuggestionIds.length === 1 ? "" : "s"}
                  </span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      handle?.review.acceptCommentSuggestions(thread.root.id);
                    }}
                  >
                    Accept them
                  </button>
                </div>
              ) : null}

              {replyTo === thread.root.id ? (
                <div className="composer inline">
                  <textarea
                    autoFocus
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (replyDraft.trim()) {
                        handle?.review.replyToComment(
                          thread.root.id,
                          replyDraft.trim(),
                        );
                      }
                      setReplyDraft("");
                      setReplyTo(null);
                    }}
                  >
                    Reply
                  </button>
                </div>
              ) : (
                <div className="thread-actions">
                  <button
                    disabled={!canComment}
                    onClick={(event) => {
                      event.stopPropagation();
                      setReplyTo(thread.root.id);
                    }}
                  >
                    Reply
                  </button>
                  <button
                    disabled={!canComment}
                    onClick={(event) => {
                      event.stopPropagation();
                      handle?.review.setCommentResolved(
                        thread.root.id,
                        !thread.root.resolved,
                      );
                    }}
                  >
                    {thread.root.resolved ? "Reopen" : "Resolve"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
