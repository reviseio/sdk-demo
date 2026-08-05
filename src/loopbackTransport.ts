import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";

/**
 * A Yjs transport that never leaves the tab.
 *
 * A real integration would hand the SDK a Hocuspocus or y-websocket provider.
 * This demo has no server, so it relays between two in-memory peers instead —
 * which is enough to show what the SDK asks of a provider: a document, an
 * awareness instance, and remote updates applied with a transaction origin
 * that identifies the transport.
 */
export class LoopbackHub {
  private readonly peers = new Set<LoopbackProvider>();

  connect(peer: LoopbackProvider): void {
    for (const existing of this.peers) {
      Y.applyUpdate(peer.doc, Y.encodeStateAsUpdate(existing.doc), peer);
      const clients = Array.from(existing.awareness.getStates().keys());
      if (clients.length > 0) {
        applyAwarenessUpdate(
          peer.awareness,
          encodeAwarenessUpdate(existing.awareness, clients),
          peer,
        );
      }
    }
    this.peers.add(peer);
    const local = Y.encodeStateAsUpdate(peer.doc);
    for (const other of this.peers) {
      if (other !== peer) Y.applyUpdate(other.doc, local, other);
    }
  }

  disconnect(peer: LoopbackProvider): void {
    this.peers.delete(peer);
    for (const other of this.peers) {
      removeAwarenessStates(
        other.awareness,
        [peer.awareness.clientID],
        "loopback-disconnect",
      );
    }
  }

  broadcast(from: LoopbackProvider, update: Uint8Array): void {
    for (const peer of this.peers) {
      if (peer !== from) Y.applyUpdate(peer.doc, update, peer);
    }
  }

  broadcastAwareness(from: LoopbackProvider, update: Uint8Array): void {
    for (const peer of this.peers) {
      if (peer !== from) applyAwarenessUpdate(peer.awareness, update, peer);
    }
  }
}

export class LoopbackProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private disposed = false;

  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    // An update we applied on the hub's behalf carries this provider as its
    // origin; echoing it would loop.
    if (origin === this || this.disposed) return;
    this.hub.broadcast(this, update);
  };

  private readonly onAwareness = (
    {
      added,
      updated,
      removed,
    }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || this.disposed) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    this.hub.broadcastAwareness(
      this,
      encodeAwarenessUpdate(this.awareness, changed),
    );
  };

  /** The document and awareness come from the SDK — a real provider would be
   * handed them the same way and open a socket for them. */
  constructor(
    private readonly hub: LoopbackHub,
    doc: Y.Doc,
    awareness: Awareness,
  ) {
    this.doc = doc;
    this.awareness = awareness;
    this.doc.on("update", this.onUpdate);
    this.awareness.on("update", this.onAwareness);
    hub.connect(this);
  }

  destroy(): void {
    this.disposed = true;
    this.doc.off("update", this.onUpdate);
    this.awareness.off("update", this.onAwareness);
    this.hub.disconnect(this);
    // The document and awareness belong to the editor that made them.
  }
}
