import type {
  ReviseEditorHandle,
  ReviseSelectionSnapshot,
} from "@reviseio/sdk";

/** Live selection, straight off `selection.observe()`. Nothing here scrapes
 * the DOM — the editor is a canvas, and this is the supported way to know
 * what the user is looking at. */
export function SelectionPanel({
  handle,
  selection,
}: {
  handle: ReviseEditorHandle | null;
  selection: ReviseSelectionSnapshot | null;
}) {
  if (!selection) {
    return (
      <div className="empty">
        <p>Nothing selected.</p>
      </div>
    );
  }

  // Block ids the selection touches, in document order. A collapsed caret
  // has no text target, so fall back to the caret's own block.
  const blockIds = (() => {
    const fromSegments =
      selection.target?.segments?.map((segment) => segment.blockId) ?? [];
    const unique = [...new Set(fromSegments)];
    if (unique.length > 0) return unique;
    return selection.anchor?.blockId ? [selection.anchor.blockId] : [];
  })();

  return (
    <div className="panel">
      <dl className="facts">
        <dt>Text</dt>
        <dd>{selection.text ? `“${selection.text}”` : <em>collapsed caret</em>}</dd>
        <dt>Collapsed</dt>
        <dd>{String(selection.collapsed)}</dd>
        <dt>Block IDs</dt>
        <dd>
          {blockIds.length > 0 ? (
            <code style={{ fontSize: 12 }}>{blockIds.join(", ")}</code>
          ) : (
            <em>none</em>
          )}
        </dd>
        <dt>Segments</dt>
        <dd>{selection.target?.segments?.length ?? 0}</dd>
        <dt>Active marks</dt>
        <dd>{selection.activeMarks.join(", ") || <em>none</em>}</dd>
        <dt>Comments here</dt>
        <dd>{selection.activeCommentIds.length}</dd>
        <dt>Changes here</dt>
        <dd>{selection.activeChangeIds.length}</dd>
      </dl>

      <div className="panel-foot">
        <button
          onClick={() => {
            const capture = handle?.selection.capture();
            if (capture) window.setTimeout(() => handle?.selection.restore(capture), 1200);
          }}
        >
          Capture &amp; restore in 1.2s
        </button>
        <button onClick={() => handle?.selection.clear()}>Clear</button>
      </div>

      <p className="hint pad">
        Capture and restore is what keeps a selection alive while focus moves
        into host UI — a dialog, a prompt box, a form field. The block IDs are
        the same ones agent tools address.
      </p>
    </div>
  );
}
