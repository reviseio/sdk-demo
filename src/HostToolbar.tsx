import { useEffect, useState } from "react";
import type {
  ReviseDocumentRole,
  ReviseEditorHandle,
  ReviseReviewState,
  ReviseToolbarState,
} from "@reviseio/sdk";

export type ThemePreference = "light" | "dark" | "system";
export type MarkupStyle = "revise" | "word";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <span className="segmented" title={title}>
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? "on" : ""}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}
/**
 * A host-owned toolbar built on `handle.toolbar` / `handle.view` /
 * `handle.review`. It complements the native ribbon by demonstrating the
 * controls an integrator can wire into its own application shell.
 */
export function HostToolbar({
  handle,
  toolbar,
  review,
  role,
  mode,
  themePref,
  onThemePref,
  markupStyle,
  onMarkupStyle,
}: {
  handle: ReviseEditorHandle | null;
  toolbar: ReviseToolbarState | null;
  review: ReviseReviewState | null;
  role: ReviseDocumentRole;
  /** Tracked by the host from `onDocumentModeChange` — reading it off the
   * handle during render throws while a document is still opening. */
  mode: string;
  themePref: ThemePreference;
  onThemePref: (next: ThemePreference) => void;
  markupStyle: MarkupStyle;
  onMarkupStyle: (next: MarkupStyle) => void;
}) {
  const disabled = !handle || role === "viewer";

  // Live word count via getStatistics() — a text-stats pass, no layout, so a
  // debounce keeps it honest during sustained typing.
  const [stats, setStats] = useState<{ words: number; chars: number } | null>(
    null,
  );
  useEffect(() => {
    if (!handle) return;
    let timer: number | undefined;
    const refresh = () => {
      try {
        const measured = handle.getStatistics();
        setStats({ words: measured.wordCount, chars: measured.characterCount });
      } catch {
        // Document still opening.
      }
    };
    refresh();
    const unsubscribe = handle.toolbar.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 300);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [handle]);

  return (
    <div className="host-toolbar">
      <div className="group">
        <button
          className="fmt"
          disabled={!handle || !toolbar?.canUndo}
          onClick={() => handle?.toolbar.undo()}
          title="Undo"
        >
          ↺
        </button>
        <button
          className="fmt"
          disabled={!handle || !toolbar?.canRedo}
          onClick={() => handle?.toolbar.redo()}
          title="Redo"
        >
          ↻
        </button>
      </div>

      <div className="group">
        <span className="group-label">Mode</span>
        <Segmented
          value={mode === "suggesting" ? "suggesting" : "editing"}
          options={[
            // A suggester's edits are always tracked; the role clamps the
            // mode, so editing is unreachable for them — show that.
            { value: "editing", label: "Editing", disabled: role === "suggester" },
            { value: "suggesting", label: "Suggesting" },
          ]}
          disabled={disabled}
          onChange={(next) => handle?.view.setDocumentMode(next)}
          title="Document mode — suggesting records every edit as a tracked change"
        />
      </div>

      <div className="group">
        <span className="group-label">Markup</span>
        <Segmented
          value={review?.viewMode ?? "all-markup"}
          options={[
            { value: "all-markup", label: "All markup" },
            { value: "final", label: "Final" },
            { value: "original", label: "Original" },
          ]}
          disabled={!handle}
          onChange={(next) => handle?.review.setSuggestionViewMode(next)}
          title="How pending changes display: inline markup, as-if-accepted, or as-if-rejected"
        />
        <label className="direct" title="Show deleted text inline (strikethrough)">
          <input
            type="checkbox"
            checked={review?.showRemovals ?? false}
            disabled={!handle}
            onChange={(event) =>
              handle?.review.setShowRemovals(event.target.checked)
            }
          />
          <span className="group-label">Removals</span>
        </label>
      </div>

      <div className="group">
        <span className="group-label">Style</span>
        <Segmented
          value={markupStyle}
          options={[
            { value: "revise", label: "Revise" },
            { value: "word", label: "Word" },
          ]}
          onChange={onMarkupStyle}
          title="Tracked-change visualization: Revise's colored tints, or Word's red underline/strikethrough redlines"
        />
      </div>

      <div className="group">
        <span className="group-label">Theme</span>
        <Segmented
          value={themePref}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
          onChange={onThemePref}
          title="Themes the demo shell AND the editor (the SDK theme prop)"
        />
      </div>

      <div className="group">
        <button
          className="fmt wide"
          disabled={!handle}
          onClick={() => handle?.toolbar.openFind()}
          title="Find and replace"
        >
          Find
        </button>
        <button
          className="fmt wide"
          disabled={!handle}
          onClick={() => void handle?.toolbar.copyAs("markdown")}
          title="Copy the selection as Markdown"
        >
          Copy as MD
        </button>
      </div>

      <div className="group right">
        {stats ? (
          <span className="stat" title="handle.getStatistics()">
            {stats.words.toLocaleString()} words ·{" "}
            {stats.chars.toLocaleString()} chars
          </span>
        ) : null}
        <button
          className="fmt wide"
          disabled={!handle}
          onClick={() => handle?.zoom.fitWidth()}
          title="Fit the page to the pane"
        >
          Fit width
        </button>
        <button
          className="fmt"
          disabled={!handle}
          onClick={() => handle?.zoom.setZoom(1)}
          title="Zoom to 100%"
        >
          100%
        </button>
      </div>
    </div>
  );
}
