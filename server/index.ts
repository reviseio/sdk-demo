/**
 * The demo's backend: a small stateless HTTP service built on
 * `@reviseio/sdk/backend`, showing how a host's server works on the same
 * document its browser clients are editing.
 *
 * Protocol: the client POSTs its Y.Doc as one encoded update; the server
 * decodes it, runs semantic tools against it, and responds with only the
 * DELTA (the update relative to the state it received). The client applies
 * that delta to its live document — a plain CRDT merge, so it lands cleanly
 * even if the user kept typing during the round-trip, and suggesting-mode
 * edits show up as reviewable tracked changes in the editor.
 *
 * Run with `npm run server` (port 8787; the Vite dev server proxies /api).
 */
import http from "node:http";
import * as Y from "yjs";
import {
  createServerDocumentSession,
  decodeYDoc,
  ydocToDocument,
  ydocToDocx,
  type ServerDocumentSession,
} from "@reviseio/sdk/backend";

const PORT = Number(process.env.PORT ?? 8787);

// Deliberately stateless: every request carries the full document and gets
// back a delta. A production service would keep a session per room instead,
// but statelessness keeps the demo honest about who owns persistence (the
// host) and makes the endpoints safe to kill and restart mid-demo.

type JsonBody = Record<string, unknown>;

const b64decode = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, "base64"));
const b64encode = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64");

function readBody(request: http.IncomingMessage): Promise<JsonBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonBody);
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

/** Decode the client's document and remember where its state ended. */
function openDocument(body: JsonBody): { ydoc: Y.Doc; baseline: Uint8Array } {
  if (typeof body.update !== "string") {
    throw new Error("Missing `update` (base64 Yjs document state).");
  }
  const ydoc = decodeYDoc(b64decode(body.update));
  return { ydoc, baseline: Y.encodeStateVector(ydoc) };
}

/** Everything the server changed, as a delta the client can merge. */
function deltaSince(ydoc: Y.Doc, baseline: Uint8Array): string {
  return b64encode(Y.encodeStateAsUpdate(ydoc, baseline));
}

async function withSession<T>(
  ydoc: Y.Doc,
  documentId: string,
  mode: "editing" | "suggesting",
  work: (session: ServerDocumentSession) => Promise<T>,
): Promise<T> {
  const session = await createServerDocumentSession(ydoc, {
    documentId,
    mode,
  });
  try {
    return await work(session);
  } finally {
    session.dispose();
  }
}

/** Plain text of one block, for scanning without loading tool context. */
function blockText(block: unknown): string {
  const collect = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const record = node as { text?: string; children?: unknown[] };
    let out = typeof record.text === "string" ? record.text : "";
    for (const child of record.children ?? []) out += collect(child);
    return out;
  };
  return collect(block);
}

/** Phrase → tighter phrase. The review pass suggests these where they occur. */
const WORDINESS: Array<{ find: string; replace: string }> = [
  { find: "in order to", replace: "to" },
  { find: "should be able to", replace: "can" },
  { find: "at this point in time", replace: "now" },
  { find: "a majority of", replace: "most" },
  { find: "utilize", replace: "use" },
  { find: "leverage", replace: "use" },
  { find: "best practice", replace: "proven practice" },
  { find: "going forward", replace: "from now on" },
];

interface ReviewResponse {
  log: string[];
  suggestionIds: string[];
  stats: unknown;
  update: string;
}

/**
 * The canned "counsel review" pass: measure the document, suggest wordiness
 * fixes as tracked changes, and leave a comment on the longest paragraph.
 * Everything lands as pending suggestions the client accepts or rejects.
 */
async function reviewPass(body: JsonBody): Promise<ReviewResponse> {
  const { ydoc, baseline } = openDocument(body);
  const documentId = String(body.documentId ?? "demo-document");
  return withSession(ydoc, documentId, "suggesting", async (session) => {
    const log: string[] = [];
    const suggestionIds: string[] = [];
    const pendingBefore = new Set(session.getPendingSuggestionIds());

    const measured = await session.tools.call("measure_document");
    log.push(
      `measure_document: ${measured.data.wordCount} words in ${measured.data.totalBlocks} blocks.`,
    );

    // One replace call per block with every matching pair batched together.
    // Sequential calls to the same block would re-plan it — earlier calls'
    // suggestion records get superseded under fresh IDs — so batching is what
    // keeps the returned `suggestionIds` the ones that actually survive.
    const blocks = ydocToDocument(ydoc).children as Array<{ id?: string }>;
    for (const block of blocks) {
      if (!block.id) continue;
      const text = blockText(block);
      const pairs = WORDINESS.filter((pair) => text.includes(pair.find));
      if (pairs.length === 0) continue;
      const result = await session.tools.execute("replace", {
        id: block.id,
        replacements: pairs.map((pair) => ({
          find: pair.find,
          replace: pair.replace,
          occurrence: "all" as const,
        })),
      });
      if (result.ok) {
        suggestionIds.push(...(result.value.suggestionIds ?? []));
        log.push(
          `replace: ${pairs
            .map((pair) => `"${pair.find}" → "${pair.replace}"`)
            .join(", ")} in block ${block.id} (${result.value.suggestionIds?.length ?? 0} suggestion record${(result.value.suggestionIds?.length ?? 0) === 1 ? "" : "s"}).`,
        );
      } else {
        log.push(`replace: block ${block.id} skipped (${result.error.code}).`);
      }
    }
    if (suggestionIds.length === 0) {
      log.push("replace: no wordy phrases found — nothing to suggest.");
    }

    // Re-read: the replacements above may have re-planned block contents.
    const longest = (ydocToDocument(ydoc).children as Array<{ id?: string }>)
      .map((block) => ({ id: block.id, text: blockText(block) }))
      .filter((entry) => entry.id && entry.text.trim().length > 0)
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (longest?.id) {
      // Comments require their target in context, same as for a model: load
      // the block first.
      await session.tools.execute("read_specific_blocks", {
        block_ids: [longest.id],
        context_notes: "Annotating the longest paragraph.",
      });
      const comment = await session.tools.execute("leave_comment", {
        id: longest.id,
        anchor: { whole_block: true },
        comment: `Longest paragraph in the document (${longest.text.length} characters) — consider whether it earns its length. — demo backend service`,
      });
      log.push(
        comment.ok
          ? `leave_comment: annotated the longest paragraph (${longest.id}).`
          : `leave_comment: skipped (${comment.error.code}).`,
      );
    }

    // Belt and braces: report the records that actually survived the pass
    // (a later operation on the same block can supersede earlier ones), not
    // the raw accumulation of per-call IDs.
    const created = session
      .getPendingSuggestionIds()
      .filter((id) => !pendingBefore.has(id));
    if (created.length !== suggestionIds.length) {
      log.push(
        `note: ${suggestionIds.length - created.length} superseded record(s) dropped from the batch.`,
      );
    }

    return {
      log,
      suggestionIds: created,
      stats: measured.data,
      update: deltaSince(ydoc, baseline),
    };
  });
}

/** Find/replace across every block containing the phrase. */
async function replaceEverywhere(body: JsonBody) {
  const { ydoc, baseline } = openDocument(body);
  const find = String(body.find ?? "");
  const replace = String(body.replace ?? "");
  const mode = body.mode === "editing" ? "editing" : "suggesting";
  if (!find) throw new Error("Missing `find`.");
  const documentId = String(body.documentId ?? "demo-document");
  return withSession(ydoc, documentId, mode, async (session) => {
    const blocks = ydocToDocument(ydoc).children as Array<{ id?: string }>;
    const suggestionIds: string[] = [];
    let replacedBlocks = 0;
    for (const block of blocks) {
      if (!block.id || !blockText(block).includes(find)) continue;
      const result = await session.tools.execute("replace", {
        id: block.id,
        replacements: [{ find, replace, occurrence: "all" }],
      });
      if (result.ok) {
        replacedBlocks += 1;
        suggestionIds.push(...(result.value.suggestionIds ?? []));
      }
    }
    return {
      mode,
      replacedBlocks,
      suggestionIds,
      update: deltaSince(ydoc, baseline),
    };
  });
}

async function measure(body: JsonBody) {
  const { ydoc } = openDocument(body);
  const documentId = String(body.documentId ?? "demo-document");
  return withSession(ydoc, documentId, "editing", async (session) => {
    const measured = await session.tools.call("measure_document", {
      include_sections: true,
    });
    return { stats: measured.data };
  });
}

/** Any tool by name — the server-side twin of the client's tool console. */
async function runTool(body: JsonBody) {
  const { ydoc, baseline } = openDocument(body);
  const documentId = String(body.documentId ?? "demo-document");
  const mode = body.mode === "editing" ? "editing" : "suggesting";
  const tool = String(body.tool ?? "");
  const input = (body.input ?? {}) as Record<string, never>;
  return withSession(ydoc, documentId, mode, async (session) => {
    const result = await session.tools.executeDynamic(tool, input);
    return result.ok
      ? {
          ok: true as const,
          message: result.value.message,
          data: result.value.data,
          contextHtml: result.value.context?.html ?? null,
          suggestionIds: result.value.suggestionIds,
          update: deltaSince(ydoc, baseline),
        }
      : { ok: false as const, error: result.error };
  });
}

async function exportDocx(body: JsonBody): Promise<Uint8Array> {
  const { ydoc } = openDocument(body);
  return ydocToDocx(ydoc);
}

const server = http.createServer((request, response) => {
  const respond = (status: number, payload: unknown) => {
    const json = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    response.end(json);
  };

  const route = async () => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") {
      respond(200, { ok: true, service: "revise-sdk-demo-backend" });
      return;
    }
    if (request.method !== "POST") {
      respond(404, { error: "Unknown route." });
      return;
    }
    const body = await readBody(request);
    switch (url.pathname) {
      case "/api/review":
        respond(200, await reviewPass(body));
        return;
      case "/api/replace":
        respond(200, await replaceEverywhere(body));
        return;
      case "/api/measure":
        respond(200, await measure(body));
        return;
      case "/api/tool":
        respond(200, await runTool(body));
        return;
      case "/api/export": {
        const bytes = await exportDocx(body);
        response.writeHead(200, {
          "content-type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "access-control-allow-origin": "*",
        });
        response.end(Buffer.from(bytes));
        return;
      }
      default:
        respond(404, { error: "Unknown route." });
    }
  };

  route().catch((error: unknown) => {
    respond(400, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
});

server.listen(PORT, () => {
  console.log(
    `revise-sdk-demo backend listening on http://localhost:${PORT} — start the app with \`npm run dev\` and open the Backend panel.`,
  );
});
