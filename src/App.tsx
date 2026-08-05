import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReviseEditor,
  createEmptyDocx,
  ReviseRoleError,
  type ReviseCollaborationState,
  type ReviseDocumentRole,
  type ReviseEditorHandle,
  type ReviseReviewState,
  type ReviseSelectionSnapshot,
  type ReviseToolbarState,
  type ReviseTrackedChange,
} from "@reviseio/sdk";
import "@reviseio/sdk/style.css";

import { SAMPLE_DOCUMENTS } from "./sampleDocument";
import type { Doc as YDoc } from "yjs";
import type { Awareness as YAwareness } from "y-protocols/awareness";
import { LoopbackHub, LoopbackProvider } from "./loopbackTransport";
import {
  HostToolbar,
  type MarkupStyle,
  type ThemePreference,
} from "./HostToolbar";
import { ChangesPanel } from "./panels/ChangesPanel";
import { CommentsPanel } from "./panels/CommentsPanel";
import { ToolConsole } from "./panels/ToolConsole";
import { PresencePanel } from "./panels/PresencePanel";
import { SelectionPanel } from "./panels/SelectionPanel";

// Collaboration is enabled by default. `?collab=0` disables the in-memory
// transport when testing the editor without a shared Yjs document.
const COLLAB_ON = new URLSearchParams(location.search).get("collab") !== "0";

const ME = {
  id: "u-you",
  name: "You",
  color: "#7C5CFF",
};

const COLLEAGUE = {
  id: "u-dana",
  name: "Dana",
  color: "#12A594",
};

type PanelId = "changes" | "comments" | "tools" | "presence" | "selection";

const PANELS: Array<{ id: PanelId; label: string }> = [
  { id: "changes", label: "Changes" },
  { id: "comments", label: "Comments" },
  { id: "tools", label: "Agent tools" },
  { id: "presence", label: "Presence" },
  { id: "selection", label: "Selection" },
];

export default function App() {
  const editorRef = useRef<ReviseEditorHandle | null>(null);
  const [handle, setHandle] = useState<ReviseEditorHandle | null>(null);
  const [colleagueHandle, setColleagueHandle] =
    useState<ReviseEditorHandle | null>(null);

  const [role, setRole] = useState<ReviseDocumentRole>("editor");
  const [panel, setPanel] = useState<PanelId>("changes");
  const [review, setReview] = useState<ReviseReviewState | null>(null);
  const [toolbar, setToolbar] = useState<ReviseToolbarState | null>(null);
  const [selection, setSelection] = useState<ReviseSelectionSnapshot | null>(
    null,
  );
  const [presence, setPresence] = useState<ReviseCollaborationState | null>(
    null,
  );
  const [changes, setChanges] = useState<ReviseTrackedChange[]>([]);
  const [openDocs, setOpenDocs] = useState<
    Array<{ id: string; title: string; active: boolean }>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [showColleague, setShowColleague] = useState(false);
  // Mirrored from the callback rather than read off the handle: the accessors
  // throw until a document has finished opening.
  const [mode, setMode] = useState("editing");

  // Theme: light by default; "system" follows the OS. The resolved value
  // themes BOTH the demo shell (CSS variables via data-theme) and the editor
  // itself (the SDK's `theme` prop).
  const [themePref, setThemePref] = useState<ThemePreference>("light");
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const resolvedTheme: "light" | "dark" =
    themePref === "system" ? (systemDark ? "dark" : "light") : themePref;
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  // Tracked-change visualization: Revise tints or Word-style redlines.
  const [markupStyle, setMarkupStyle] = useState<MarkupStyle>(
    new URLSearchParams(window.location.search).has("word") ? "word" : "revise",
  );

  // One shared room. The SDK builds each document and hands it to `connect`,
  // which is where a real integration would open its socket.
  const hub = useMemo(() => new LoopbackHub(), []);
  const connectMine = useMemo(
    () => (doc: YDoc, awareness: YAwareness) =>
      new LoopbackProvider(hub, doc, awareness),
    [hub],
  );
  const connectTheirs = useMemo(
    () => (doc: YDoc, awareness: YAwareness) =>
      new LoopbackProvider(hub, doc, awareness),
    [hub],
  );

  const initialDocuments = useMemo(
    () => [
      {
        id: SAMPLE_DOCUMENTS[0].id,
        title: SAMPLE_DOCUMENTS[0].title,
        docx: SAMPLE_DOCUMENTS[0].file(),
        ...(COLLAB_ON
          ? { collaboration: { connect: connectMine, synced: true } }
          : {}),
      },
    ],
    [connectMine],
  );

  const say = useCallback((message: string) => {
    setBanner(message);
    window.setTimeout(
      () => setBanner((current) => (current === message ? null : current)),
      4000,
    );
  }, []);

  // Every panel reads from a subscription rather than polling; the changes
  // list is pulled when the counts move, since it is derived from the
  // document and would be wasteful to recompute per keystroke.
  useEffect(() => {
    if (!handle) return;
    const unsubscribeReview = handle.review.subscribe((state) => {
      setReview(state);
      setChanges(handle.review.listChanges());
    });
    const unsubscribeToolbar = handle.toolbar.subscribe(setToolbar);
    const unsubscribeSelection = handle.selection.observe(setSelection);
    const unsubscribeDocuments = handle.documents.subscribe((state) => {
      setOpenDocs(state.documents);
      setActiveId(state.activeDocumentId);
    });
    const unsubscribePresence = handle.collaboration.subscribe(setPresence);
    return () => {
      unsubscribeReview();
      unsubscribeToolbar();
      unsubscribeSelection();
      unsubscribeDocuments();
      unsubscribePresence();
    };
  }, [handle]);

  const newDocument = async () => {
    if (!handle) return;
    const id = `doc-${Date.now().toString(36)}`;
    await handle.documents.open({
      id,
      title: "Untitled",
      docx: await createEmptyDocx(),
    });
    say("New blank document — same session, its own tab");
  };

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importDocument = async (file: File) => {
    if (!handle) return;
    const id = `import-${Date.now().toString(36)}`;
    try {
      // The SDK's import pipeline: format inferred from the filename (DOCX,
      // Markdown, plain text, HTML), parsed entirely client-side.
      await handle.documents.open({ id, title: file.name, docx: file });
      say(`Imported ${file.name} — parsed in the browser, no upload`);
    } catch (error) {
      say(
        error instanceof Error
          ? `Import failed: ${error.message}`
          : "Import failed",
      );
    }
  };

  const exportDocx = async () => {
    if (!handle) return;
    const blob = await handle.tools.exportDocx();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${handle.document().title}.docx`;
    link.click();
    URL.revokeObjectURL(url);
    say(`Exported ${(blob.size / 1024).toFixed(0)} KB of .docx`);
  };

  const changeRole = (next: ReviseDocumentRole) => {
    setRole(next);
    say(
      next === "suggester"
        ? "Suggest-only: edits become tracked changes, and accept/reject is withheld"
        : next === "viewer"
          ? "Read-only: the document cannot be edited or commented on"
          : "Full editor: everything is permitted",
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" />
          <div>
            <strong>Revise SDK Demo App</strong>
            <small>
              a host application built on the{" "}
              <a
                href="https://sdk.revise.io"
                target="_blank"
                rel="noopener noreferrer"
              >
                Revise SDK
              </a>
            </small>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Open documents">
          {openDocs.map((doc) => (
            <button
              key={doc.id}
              role="tab"
              aria-selected={doc.id === activeId}
              className={doc.id === activeId ? "tab active" : "tab"}
              onClick={() => handle?.documents.activate(doc.id)}
            >
              {doc.title}
            </button>
          ))}
          <button className="tab ghost" onClick={() => void newDocument()}>
            + New Document
          </button>
          <button
            className="tab ghost"
            onClick={() => importInputRef.current?.click()}
          >
            Import Document
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".docx,.md,.markdown,.txt,.html,.htm"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importDocument(file);
              event.target.value = "";
            }}
          />
        </div>

        <div className="topbar-actions">
          <label className="role">
            Role
            <select
              value={role}
              onChange={(event) =>
                changeRole(event.target.value as ReviseDocumentRole)
              }
            >
              <option value="editor">Editor</option>
              <option value="suggester">Suggest-only</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button onClick={() => setShowColleague((open) => !open)}>
            {showColleague ? "Hide Dana" : "Show Dana"}
          </button>
          <button onClick={exportDocx}>Export .docx</button>
        </div>
      </header>



      <HostToolbar
        handle={handle}
        toolbar={toolbar}
        review={review}
        role={role}
        mode={mode}
        themePref={themePref}
        onThemePref={setThemePref}
        markupStyle={markupStyle}
        onMarkupStyle={setMarkupStyle}
      />

      <main className="workspace">
        <section
          className={showColleague ? "editors with-colleague" : "editors"}
        >
          <div className="editor-shell">
            <ReviseEditor
              key="mine"
              currentUser={ME}
              role={role}
              initialDocuments={initialDocuments}
              settings={{
                trackedChanges: { markupStyle, showRemovalsInReview: true },
              }}
              theme={resolvedTheme}
              showTitleBar={false}
              // The SDK's full ribbon by default — formatting lives there.
              // ?headless=1 turns it off to demo a fully host-owned chrome.
              toolbarMode={
                new URLSearchParams(window.location.search).has("headless")
                  ? "none"
                  : "native"
              }
              defaultDocumentMode="editing"
              defaultCommentsOpen={false}
              canvasBackground={resolvedTheme === "dark" ? "#14120f" : "#f4f2ef"}
              onReady={(editor) => {
                // Hold it, do not publish it: `onReady` means the editor
                // exists, not that a document does, and every scoped
                // controller throws until one has finished opening.
                editorRef.current = editor;
              }}
              onDocumentReady={() => {
                setHandle(editorRef.current);
              }}
              onDocumentModeChange={(_id, next) => setMode(next)}
              onAnalyticsEvent={(event, properties) => {
                // Where a real host would call its own analytics service.
                console.debug("[demo analytics]", event, properties ?? {});
              }}
              onError={(error: Error) => {
                console.error("[demo] editor error", error);
                say(`Editor error: ${error.message}`);
              }}
            />
          </div>

          {showColleague ? (
            <div className="editor-shell colleague">
              <div className="colleague-label">
                <span className="dot" style={{ background: COLLEAGUE.color }} />
                Dana&rsquo;s window — same document, her own session
              </div>
              <ReviseEditor
                key="theirs"
                currentUser={COLLEAGUE}
                role="suggester"
                settings={{
                  trackedChanges: { markupStyle, showRemovalsInReview: true },
                }}
                theme={resolvedTheme}
                showTitleBar={false}
                toolbarMode="none"
                autoFocus={false}
                defaultCommentsOpen={false}
                canvasBackground={
                  resolvedTheme === "dark" ? "#14120f" : "#f4f2ef"
                }
                initialDocuments={[
                  {
                    id: SAMPLE_DOCUMENTS[0].id,
                    title: SAMPLE_DOCUMENTS[0].title,
                    // No source file: she joins the room rather than seeding it.
                    collaboration: {
                      connect: connectTheirs,
                      synced: true,
                      seed: "never",
                    },
                  },
                ]}
                onReady={setColleagueHandle}
              />
            </div>
          ) : null}
        </section>

        <aside className="rail">
          <nav className="rail-tabs">
            {PANELS.map((entry) => (
              <button
                key={entry.id}
                className={panel === entry.id ? "rail-tab active" : "rail-tab"}
                onClick={() => setPanel(entry.id)}
              >
                {entry.label}
                {entry.id === "changes" && changes.length > 0 ? (
                  <span className="count">{changes.length}</span>
                ) : null}
                {entry.id === "comments" && review?.commentThreads.length ? (
                  <span className="count">{review.commentThreads.length}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="rail-body">
            {panel === "changes" ? (
              <ChangesPanel
                handle={handle}
                changes={changes}
                review={review}
                role={role}
                onRefuse={(error) =>
                  say(
                    error instanceof ReviseRoleError
                      ? error.message
                      : String(error),
                  )
                }
              />
            ) : null}
            {panel === "comments" ? (
              <CommentsPanel handle={handle} review={review} role={role} />
            ) : null}
            {panel === "tools" ? (
              <ToolConsole handle={handle} onNotice={say} />
            ) : null}
            {panel === "presence" ? (
              <PresencePanel
                presence={presence}
                colleagueOpen={showColleague}
                colleagueReady={Boolean(colleagueHandle)}
              />
            ) : null}
            {panel === "selection" ? (
              <SelectionPanel handle={handle} selection={selection} />
            ) : null}
          </div>
        </aside>
      </main>
      {banner ? (
        <div className="toast" role="status">
          {banner}
        </div>
      ) : null}
    </div>
  );
}
