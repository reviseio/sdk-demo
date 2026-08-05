import type { ReviseCollaborationState } from "@reviseio/sdk";

/** Presence read from `collaboration.getState()` — the roster the SDK
 * normalises out of Yjs awareness, with the colours the carets are drawn in. */
export function PresencePanel({
  presence,
  colleagueOpen,
  colleagueReady,
}: {
  presence: ReviseCollaborationState | null;
  colleagueOpen: boolean;
  colleagueReady: boolean;
}) {
  if (!presence?.enabled) {
    return (
      <div className="empty">
        <p>This document has no collaboration transport attached.</p>
        <p className="hint">
          The Mutual NDA tab is the shared one — collaboration in this demo
          is an in-page relay, so click &ldquo;Show Dana&rdquo; in the header
          to open a second live session below. Two separate browser tabs
          will NOT sync: that needs a real transport (Hocuspocus,
          y-websocket) plus a server, which the host application owns.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>{presence.synced ? "Synced" : "Connecting…"}</span>
        <span className="hint">in-memory transport</span>
      </div>

      <ul className="peers">
        {presence.peers.map((peer) => (
          <li key={peer.clientId}>
            <span className="dot" style={{ background: peer.color }} />
            <strong>{peer.name ?? "Anonymous"}</strong>
            {peer.isLocal ? <span className="you">you</span> : null}
          </li>
        ))}
      </ul>

      <p className="hint pad">
        {colleagueOpen
          ? colleagueReady
            ? "Dana's window is open below. Type in either document and watch the other follow, carets included."
            : "Dana's window is opening…"
          : "Use “Show Dana” in the header to open a second session on the same document."}
      </p>

      <p className="hint pad">
        The host owns the transport. This demo relays between two peers in
        memory inside this one page — two separate browser tabs will not
        sync. A real integration passes a Hocuspocus or y-websocket provider
        backed by its own server, and the SDK treats it identically.
      </p>
    </div>
  );
}
