/**
 * Exhaustive exercise of `@reviseio/sdk/backend`.
 *
 * Touches every exported function and all 24 semantic tools in both editing
 * and suggesting modes, asserting observable document state after each call.
 * Run with `npm run exercise:backend`. Exits non-zero if any check fails.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  RESERVED_DOCUMENT_KEYS,
  ReviseToolError,
  assertUsableSharedDocument,
  createReviseYDoc,
  createServerDocumentSession,
  decodeYDoc,
  documentToDocx,
  encodeYDoc,
  fileToYDoc,
  hasDocument,
  installDomShims,
  parseDocument,
  seedYDocFromFile,
  ydocToDocument,
  ydocToDocx,
  type ServerDocumentSession,
} from "@reviseio/sdk/backend";

const outputDirectory = fileURLToPath(new URL("./output/", import.meta.url));
const bytes = (value: string) => new TextEncoder().encode(value);

let passed = 0;
const failures: string[] = [];
let currentSection = "";

function section(name: string) {
  currentSection = name;
  console.log(`\n## ${name}`);
}

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ok: ${name}`);
  } else {
    const rendered =
      detail === undefined ? "" : ` — got ${JSON.stringify(detail)?.slice(0, 400)}`;
    failures.push(`${currentSection} → ${name}${rendered}`);
    console.log(`  FAIL: ${name}${rendered}`);
  }
}

/** Full plain text of the document, blocks joined with \n. */
function docText(ydoc: Parameters<typeof ydocToDocument>[0]): string {
  const collect = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const record = node as { text?: string; children?: unknown[] };
    let out = typeof record.text === "string" ? record.text : "";
    for (const child of record.children ?? []) out += collect(child);
    return out;
  };
  const doc = ydocToDocument(ydoc);
  return [...doc.children, ...((doc as { notes?: unknown[] }).notes ?? [])]
    .map((block) => collect(block))
    .join("\n");
}

function blockIds(ydoc: Parameters<typeof ydocToDocument>[0]): string[] {
  return (ydocToDocument(ydoc).children as Array<{ id?: string }>).map(
    (block) => block.id ?? "",
  );
}

async function session(
  markdown: string,
  options: { mode?: "editing" | "suggesting" } = {},
): Promise<{ ydoc: ReturnType<typeof createReviseYDoc>; server: ServerDocumentSession }> {
  const ydoc = await fileToYDoc(bytes(markdown), "exercise.md");
  const server = await createServerDocumentSession(ydoc, {
    documentId: `exercise-${Math.random().toString(36).slice(2)}`,
    ...(options.mode ? { mode: options.mode } : {}),
  });
  return { ydoc, server };
}

// ---------------------------------------------------------------------------

async function conversionAndPersistence() {
  section("conversion & persistence");

  await installDomShims(); // exported entry point; idempotent

  const md = await parseDocument(bytes("# Title\n\nHello **bold** world."), "a.md");
  check("parseDocument markdown produces blocks", md.children.length === 2, md.children.length);

  const txt = await parseDocument(bytes("line one\n\nline two"), "a.txt");
  check("parseDocument txt produces blocks", txt.children.length >= 2, txt.children.length);

  const html = await parseDocument(
    bytes("<h1>H</h1><p>Para <em>em</em></p>"),
    "a.html",
  );
  check("parseDocument html produces blocks", html.children.length === 2, html.children.length);

  const docxBytes = await documentToDocx(md);
  check("documentToDocx returns zip bytes", docxBytes[0] === 0x50 && docxBytes[1] === 0x4b, docxBytes.slice(0, 4));

  const roundtripped = await parseDocument(docxBytes, "a.docx");
  const roundtrippedText = JSON.stringify(roundtripped.children);
  check("docx roundtrip preserves text", roundtrippedText.includes("Hello") && roundtrippedText.includes("bold"));

  let unsupported = "";
  try {
    await parseDocument(bytes("x"), "a.pdf");
  } catch (error) {
    unsupported = (error as Error).message;
  }
  check("parseDocument rejects unsupported extension with format list", unsupported.includes(".docx"), unsupported);

  const ydoc = await fileToYDoc(bytes("# Doc\n\nBody text."), "doc.md");
  check("fileToYDoc yields a populated document", hasDocument(ydoc));
  check("ydocToDocument reads back content", docText(ydoc).includes("Body text."));

  const exported = await ydocToDocx(ydoc);
  check("ydocToDocx exports zip bytes", exported[0] === 0x50 && exported[1] === 0x4b);

  const empty = createReviseYDoc();
  check("createReviseYDoc starts without a document", !hasDocument(empty));
  const seeded = await seedYDocFromFile(empty, bytes("Seeded."), "seed.txt");
  check("seedYDocFromFile seeds an empty room", seeded && hasDocument(empty));
  const reseeded = await seedYDocFromFile(empty, bytes("Other."), "seed.txt");
  check("seedYDocFromFile is a no-op on populated rooms", !reseeded && docText(empty).includes("Seeded."));

  const restored = decodeYDoc(encodeYDoc(ydoc));
  check("encode/decode roundtrip preserves text", docText(restored) === docText(ydoc));

  check("RESERVED_DOCUMENT_KEYS is a non-empty list", RESERVED_DOCUMENT_KEYS.length > 0, RESERVED_DOCUMENT_KEYS);
  let usable = true;
  try {
    assertUsableSharedDocument(createReviseYDoc());
  } catch {
    usable = false;
  }
  check("assertUsableSharedDocument accepts a fresh Revise doc", usable);
}

async function sessionLifecycle() {
  section("session lifecycle & guards");

  const { ydoc, server } = await session("guarded text");

  check(
    "sessions default to suggesting mode",
    server.getMode() === "suggesting",
    server.getMode(),
  );

  const definitions = server.tools.getDefinitions();
  check("getDefinitions publishes 24 tools", definitions.length === 24, definitions.length);
  check(
    "definitions carry schemas without document_id",
    definitions.every((d) => !JSON.stringify(d.inputSchema).includes("document_id")),
  );

  const unknown = await server.tools.executeDynamic("get_selection", {});
  check("executeDynamic rejects browser-only tool", !unknown.ok && unknown.error.code === "unknown_tool", unknown);

  const routed = await server.tools.executeDynamic("measure_document", { document_id: "x" });
  check("document_id input is rejected", !routed.ok && routed.error.code === "document_id_not_supported", routed);

  let toolError: ReviseToolError | null = null;
  try {
    await server.tools.call("replace", {
      id: "missing",
      replacements: [{ find: "a", replace: "b" }],
    });
  } catch (error) {
    if (error instanceof ReviseToolError) toolError = error;
  }
  check(
    "call() throws a typed ReviseToolError",
    toolError !== null && toolError.tool === "replace" && toolError.code.length > 0 && toolError.callId.length > 0,
    toolError && { tool: toolError.tool, code: toolError.code },
  );

  server.dispose();
  server.dispose(); // double dispose must be safe
  check("dispose leaves the host Y.Doc readable", docText(ydoc).includes("guarded"));
  let disposedRejects = false;
  await server.tools.call("measure_document").catch(() => {
    disposedRejects = true;
  });
  check("disposed session rejects tool calls", disposedRejects);
  let disposedThrows = false;
  try {
    server.listSuggestions();
  } catch {
    disposedThrows = true;
  }
  check("disposed session throws on suggestion APIs", disposedThrows);
}

async function readAndSearch() {
  section("read & search");

  const manyBlocks = Array.from({ length: 8 }, (_, i) => `Paragraph number ${i} content.`).join("\n\n");
  const { server } = await session(`# Reading\n\n${manyBlocks}`, {
    mode: "editing",
  });

  const read = await server.tools.call("read_blocks_from_index", {
    index: 0,
    context_notes: "N/A",
  });
  check("read_blocks_from_index returns revise-html context", read.context?.format === "revise-html" && /id="/.test(read.context.html));
  check("read data reports coverage", read.data.kind === "read_context" && read.data.coverage.requestedBlockCount > 0, read.data);
  check("read tools report null suggestionIds", read.suggestionIds === null, read.suggestionIds);

  const search = await server.tools.call("search_document", {
    queries: ["Paragraph number 3"],
    page: 0,
    context_notes: "N/A",
  });
  check("search_document finds the block", search.data.totalMatches >= 1 && !!search.data.search_result_id, search.data);
  check("search returns matched block context", !!search.context?.html.includes("Paragraph number 3"));

  const specific = await server.tools.call("read_specific_blocks", {
    block_ids: [search.data.matches[0]!.blockId],
    context_notes: "N/A",
  });
  check("read_specific_blocks loads the requested block", !!specific.context?.html.includes("Paragraph number 3"));

  const missNothing = await server.tools.call("search_document", {
    queries: ["zebra unicorn nonexistent"],
    page: 0,
    context_notes: "N/A",
  });
  check("search with no matches reports zero", missNothing.data.totalMatches === 0, missNothing.data.totalMatches);

  // Highlights: create one through the agent HTML dialect, then find it.
  const ids = server.tools; // alias
  const firstId = search.data.matches[0]!.blockId;
  await ids.call("insert_block", {
    referenceId: firstId,
    position: "after",
    content: ['<p>Plain lead-in <mark color="yellow">glowing text</mark> tail.</p>'],
  });
  const highlights = await ids.call("find_highlights", {
    page: 0,
    color: "yellow",
    context_notes: "N/A",
  });
  check("find_highlights locates the created highlight", highlights.data.totalMatches >= 1, highlights.data);
  const noBlue = await ids.call("find_highlights", {
    page: 0,
    color: "blue",
    context_notes: "N/A",
  });
  check("find_highlights filters by color", noBlue.data.totalMatches === 0, noBlue.data.totalMatches);
}

async function measurement() {
  section("measure");

  const { server } = await session(
    "# Alpha\n\nOne two three.\n\n## Beta\n\nFour five six seven.",
  );

  const measure = await server.tools.call("measure_document", {
    include_sections: true,
  });
  check("measure_document counts words", measure.data.wordCount === 9, measure.data.wordCount);
  check("measure_document reports sections", (measure.data.sections?.length ?? 0) >= 2, measure.data.sections?.length);

  const idsInDoc = (await server.tools.call("search_document", {
    queries: ["One two three"],
    page: 0,
    context_notes: "N/A",
  })).data.matches;
  const target = idsInDoc[0]!.blockId;

  const measured = await server.tools.call("measure_blocks", {
    ranges: [{ start_block_id: target }],
  });
  check("measure_blocks measures a single-block range", measured.data.ranges.length === 1 && measured.data.ranges[0]!.wordCount === 3, measured.data.ranges);

  const allBad = await server.tools.execute("measure_blocks", {
    ranges: [{ start_block_id: "does-not-exist" }],
  });
  check("measure_blocks with only bad ranges fails structurally", !allBad.ok, allBad);

  // Mixed ranges: the contract's per-range `errors` array implies the valid
  // range should still measure while the bad one is reported.
  const mixed = await server.tools.execute("measure_blocks", {
    ranges: [{ start_block_id: target }, { start_block_id: "does-not-exist" }],
  });
  check(
    "measure_blocks mixed ranges measures the valid one and reports the bad one",
    mixed.ok && mixed.value.data.ranges.length === 1 && mixed.value.data.errors.length === 1,
    mixed,
  );
}

async function textMutations() {
  section("text mutations (editing mode applies directly)");

  const { ydoc, server } = await session(
    "First alpha sentence.\n\nSecond beta sentence.\n\nThird gamma sentence. gamma again.",
    { mode: "editing" },
  );
  const [firstId, secondId, thirdId] = blockIds(ydoc);

  const replaceById = await server.tools.call("replace", {
    id: firstId,
    replacements: [{ find: "alpha", replace: "ALPHA", occurrence: "unique" }],
  });
  check("replace by id applies directly", docText(ydoc).includes("First ALPHA sentence."), docText(ydoc));
  check("editing-mode mutation reports empty suggestionIds", replaceById.suggestionIds?.length === 0, replaceById.suggestionIds);
  check("mutation data reports effect counts", replaceById.data !== null && replaceById.data!.effect.changed_target_count === 1, replaceById.data);

  const found = await server.tools.call("search_document", {
    queries: ["Second beta sentence"],
    page: 0,
    context_notes: "N/A",
  });
  await server.tools.call("replace", {
    search_result_id: found.data.search_result_id!,
    replacements: [{ find: "beta", replace: "BETA" }],
  });
  check("replace by search_result_id applies", docText(ydoc).includes("Second BETA sentence."));

  await server.tools.call("replace", {
    id: thirdId,
    replacements: [{ find: "gamma", replace: "GAMMA", occurrence: "all" }],
  });
  const gammaCount = (docText(ydoc).match(/GAMMA/g) ?? []).length;
  check("replace occurrence=all rewrites every match", gammaCount === 2, docText(ydoc));

  await server.tools.call("append_to_paragraph", {
    id: firstId,
    content: " Appended tail.",
  });
  check("append_to_paragraph appends", docText(ydoc).includes("First ALPHA sentence. Appended tail."), docText(ydoc));

  await server.tools.call("break_paragraph", {
    id: firstId,
    substring: "Appended tail.",
  });
  const afterBreak = blockIds(ydoc);
  check("break_paragraph splits into a new block", afterBreak.length === 4, afterBreak.length);

  const joined = await server.tools.call("join_paragraphs", {
    firstId: afterBreak[0]!,
    secondId: afterBreak[1]!,
    separator: " ",
  });
  check("join_paragraphs merges back", blockIds(ydoc).length === 3 && joined.data !== null, blockIds(ydoc).length);

  await server.tools.call("replace_block", {
    id: secondId,
    content: ["<p>Replaced <strong>second</strong> block.</p>"],
  });
  check("replace_block swaps content", docText(ydoc).includes("Replaced second block."), docText(ydoc));

  const insert = await server.tools.call("insert_block", {
    referenceId: secondId,
    position: "before",
    content: ["<p>Inserted before second.</p>", "<p>Another inserted.</p>"],
  });
  check(
    "insert_block inserts multiple blocks before reference",
    docText(ydoc).indexOf("Inserted before second.") < docText(ydoc).indexOf("Replaced second block.") &&
      insert.data!.effect.inserted_block_count === 2,
    insert.data,
  );

  const idsNow = blockIds(ydoc);
  const removeTarget = idsNow[1]!; // "Inserted before second."
  await server.tools.call("remove_block", { id: removeTarget });
  check("remove_block by id removes", !docText(ydoc).includes("Inserted before second."));

  const removeMulti = await server.tools.call("remove_block", {
    ids: [blockIds(ydoc)[1]!],
  });
  check("remove_block by ids removes", !docText(ydoc).includes("Another inserted.") && removeMulti.data !== null);
}

async function structureAndStyle() {
  section("structure, style & layout");

  const { ydoc, server } = await session(
    "# Heading\n\nBody **bold** here.\n\nPlain paragraph.",
    { mode: "editing" },
  );

  const styled = await server.tools.call("style_blocks", {
    selectors: "*",
    attrs: [{ name: "fontFamily", value: "Georgia, serif" }],
  });
  check("style_blocks * succeeds", styled.data !== null, styled.data);
  const styledDoc = JSON.stringify(ydocToDocument(ydoc));
  check("style_blocks writes the font marks", styledDoc.includes("Georgia"), null);

  const unbold = await server.tools.call("style_blocks", {
    selectors: "b",
    attrs: [{ name: "fontWeight", value: "normal" }],
  });
  check("style_blocks inline selector succeeds", unbold.data !== null);

  // clear_formatting removes removable marks (italic here) but intentionally
  // preserves font family, size, color, and paragraph attributes.
  const bodyId = blockIds(ydoc)[1]!;
  await server.tools.call("replace_block", {
    id: bodyId,
    content: ["<p>Body <em>styled</em> here.</p>"],
  });
  await server.tools.call("style_blocks", {
    selectors: `#${bodyId}`,
    attrs: [{ name: "fontFamily", value: "Georgia, serif" }],
  });
  const clear = await server.tools.call("clear_formatting", { id: bodyId });
  const clearedBody = JSON.stringify(ydocToDocument(ydoc).children[1]);
  check("clear_formatting removes removable marks", clear.data !== null && !clearedBody.includes("italic"), clearedBody);
  check("clear_formatting preserves font family", clearedBody.includes("Georgia"), clearedBody);

  await server.tools.call("set_title", { title: "Exercised Document" });
  const titled = ydocToDocument(ydoc) as { title?: string };
  check("set_title persists on the document", titled.title === "Exercised Document", titled.title);

  const layout = await server.tools.call("set_page_layout", {
    pageSize: "a4",
    orientation: "landscape",
    margin: "0.5in",
    showPageNumbers: true,
  });
  check("set_page_layout succeeds", layout.message !== undefined);
  const layoutDoc = JSON.stringify(ydocToDocument(ydoc));
  check("set_page_layout persists a4/landscape", /a4/i.test(layoutDoc) && /landscape/i.test(layoutDoc), null);

  await server.tools.call("set_header_footer", {
    side: "header",
    center: "Confidential draft",
  });
  await server.tools.call("set_header_footer", {
    side: "footer",
    right: "Page {PAGE} of {PAGES}",
  });
  const headered = JSON.stringify(ydocToDocument(ydoc));
  check("set_header_footer persists header text", headered.includes("Confidential draft"), null);
  // {PAGE}/{PAGES} tokens are stored as live field runs, not literal text.
  check(
    "set_header_footer stores page tokens as field runs",
    headered.includes('"field":"page"') && headered.includes('"field":"numPages"'),
    null,
  );

  const cleared = await server.tools.call("set_header_footer", {
    side: "header",
    clear: true,
  });
  check(
    "set_header_footer clear removes the header",
    cleared.message !== undefined && !JSON.stringify(ydocToDocument(ydoc)).includes("Confidential draft"),
  );

  // The layout must survive DOCX export.
  const exported = await ydocToDocx(ydoc);
  check("styled document still exports to docx", exported[0] === 0x50);
}

async function footnotes() {
  section("footnotes & endnotes");

  const { ydoc, server } = await session(
    "Anchor paragraph with target text inside.",
    { mode: "editing" },
  );
  const paragraphId = blockIds(ydoc)[0]!;

  const inserted = await server.tools.call("insert_footnote", {
    id: paragraphId,
    find: "target text",
    text: "The footnote body.",
  });
  check("insert_footnote succeeds", inserted.data !== null || inserted.message !== null, inserted);
  const withNote = ydocToDocument(ydoc) as { notes?: Array<{ id?: string }> };
  check("footnote body appears in document notes", (withNote.notes?.length ?? 0) === 1, withNote.notes?.length);
  check("document text includes the note body", docText(ydoc).includes("The footnote body."));

  const endnote = await server.tools.call("insert_footnote", {
    id: paragraphId,
    find: "Anchor",
    text: "The endnote body.",
    kind: "endnote",
  });
  check("insert_footnote endnote succeeds", endnote.data !== null || endnote.message !== null);

  // Removing a note body block also removes its inline reference.
  const noteBlocks = (ydocToDocument(ydoc) as { notes?: Array<{ id?: string }> }).notes ?? [];
  const firstNoteId = noteBlocks[0]?.id;
  if (firstNoteId) {
    await server.tools.call("remove_block", { id: firstNoteId });
    check("remove_block removes footnote body", !docText(ydoc).includes("The footnote body."), docText(ydoc));
  } else {
    check("footnote block id available for removal", false, noteBlocks);
  }

  const exported = await ydocToDocx(ydoc);
  check("document with endnote exports to docx", exported[0] === 0x50);
}

async function tables() {
  section("tables");

  const { ydoc, server } = await session("Paragraph before the table.", {
    mode: "editing",
  });
  const anchor = blockIds(ydoc)[0]!;

  await server.tools.call("insert_block", {
    referenceId: anchor,
    position: "after",
    content: [
      "<table><tr><td>R1C1</td><td>R1C2</td></tr><tr><td>R2C1</td><td>R2C2</td></tr></table>",
    ],
  });
  const tableBlock = (ydocToDocument(ydoc).children as Array<{ type?: string; id?: string }>).find(
    (block) => block.type === "table",
  );
  check(
    "insert_block creates a table block",
    !!tableBlock,
    (ydocToDocument(ydoc).children as Array<{ type?: string }>).map((b) => b.type),
  );
  if (!tableBlock?.id) return;
  const tableId = tableBlock.id;

  const readTable = await server.tools.call("read_specific_blocks", {
    block_ids: [tableId],
    context_notes: "N/A",
  });
  check("table renders in read context", !!readTable.context?.html.includes("R2C2"));

  const rows = () =>
    ((ydocToDocument(ydoc).children as Array<{ id?: string; type?: string; children?: unknown[] }>).find(
      (block) => block.id === tableId,
    )?.children ?? []) as Array<{ children?: unknown[] }>;

  await server.tools.call("insert_table_row", {
    tableId,
    referenceIndex: 0,
    position: "after",
    content: ["<td>R1bC1</td>", "<td>R1bC2</td>"],
  });
  check("insert_table_row adds a row", rows().length === 3, rows().length);
  check("inserted row content present", docText(ydoc).includes("R1bC1"));

  await server.tools.call("insert_table_column", {
    tableId,
    referenceIndex: 1,
    position: "after",
    content: ["<td>H3</td>", "<td>M3</td>", "<td>B3</td>"],
  });
  check("insert_table_column adds a cell per row", rows().every((row) => (row.children?.length ?? 0) === 3), rows().map((row) => row.children?.length));

  await server.tools.call("remove_table_row", { tableId, rowIndex: 1 });
  check("remove_table_row removes the inserted row", rows().length === 2 && !docText(ydoc).includes("R1bC1"), rows().length);

  await server.tools.call("remove_table_column", { tableId, columnIndex: 2 });
  check("remove_table_column removes the added column", rows().every((row) => (row.children?.length ?? 0) === 2), rows().map((row) => row.children?.length));
  check("table text intact after edits", docText(ydoc).includes("R2C2"));
}

async function comments() {
  section("comments");

  const { server } = await session(
    "Reviewable paragraph with notable phrasing throughout.",
    { mode: "editing" },
  );
  const search = await server.tools.call("search_document", {
    queries: ["Reviewable paragraph"],
    page: 0,
    context_notes: "N/A",
  });
  const blockId = search.data.matches[0]!.blockId;

  const comment = await server.tools.call("leave_comment", {
    id: blockId,
    anchor: { text: "notable phrasing" },
    comment: "Consider tightening this phrase.",
  });
  check(
    "leave_comment anchors to text",
    comment.data.commentId.length > 0 && comment.data.blockId === blockId,
    comment.data,
  );

  const reply = await server.tools.call("leave_comment", {
    reply_to_comment_id: comment.data.commentId,
    comment: "Agreed — flagging for the author.",
  });
  check("leave_comment replies to a thread", reply.data.commentId.length > 0, reply.data);

  // An overlapping anchor on already-commented text is rejected with the
  // thread to acknowledge; retrying with the acknowledgement proceeds.
  const overlapping = await server.tools.execute("leave_comment", {
    id: blockId,
    anchor: { whole_block: true },
    comment: "Block-level remark.",
  });
  check(
    "overlapping comment anchor is guarded",
    !overlapping.ok && overlapping.error.code === "duplicate_comment_anchor",
    overlapping,
  );
  const whole = await server.tools.call("leave_comment", {
    id: blockId,
    anchor: { whole_block: true },
    comment: "Block-level remark.",
    acknowledge_existing_thread_ids: [comment.data.commentId],
  });
  check("leave_comment whole_block anchors after acknowledgement", whole.data.commentId.length > 0, whole.data);

  const read = await server.tools.call("read_specific_blocks", {
    block_ids: [blockId],
    context_notes: "N/A",
  });
  check("comment threads render in read context", !!read.context?.html.includes("comment-thread"), read.context?.html.slice(0, 300));
}

async function suggestingAndReview() {
  section("suggesting mode & review lifecycle");

  const { ydoc, server } = await session(
    "First reviewed sentence.\n\nSecond reviewed sentence.\n\nThird reviewed sentence.",
    { mode: "suggesting" },
  );
  const [firstId, secondId, thirdId] = blockIds(ydoc);

  const first = await server.tools.call("replace", {
    id: firstId,
    replacements: [{ find: "First", replace: "1st", occurrence: "unique" }],
  });
  const second = await server.tools.call("insert_block", {
    referenceId: secondId,
    position: "after",
    content: ["<p>Suggested insertion.</p>"],
  });
  const third = await server.tools.call("remove_block", { id: thirdId });

  check("suggesting replace reports created IDs", (first.suggestionIds?.length ?? 0) > 0, first.suggestionIds);
  check("suggesting insert_block reports created IDs", (second.suggestionIds?.length ?? 0) > 0, second.suggestionIds);
  check("suggesting remove_block reports created IDs", (third.suggestionIds?.length ?? 0) > 0, third.suggestionIds);

  const all = [
    ...(first.suggestionIds ?? []),
    ...(second.suggestionIds ?? []),
    ...(third.suggestionIds ?? []),
  ];
  const pending = server.getPendingSuggestionIds();
  check("pending set equals created set", [...pending].sort().join() === [...all].sort().join(), { pending, all });

  const records = server.listSuggestions();
  check("listSuggestions covers all pending", records.length === pending.length, records.length);
  check(
    "records carry authorship metadata",
    records.every((record) => record.authorType === "ai" && !!record.agentName && !!record.createdAt),
    records,
  );

  // Persistence: pending suggestions survive encode/decode and a new session.
  const restoredYDoc = decodeYDoc(encodeYDoc(ydoc));
  const restoredServer = await createServerDocumentSession(restoredYDoc, {
    documentId: "restored-review",
    mode: "suggesting",
  });
  check(
    "pending suggestions survive persistence",
    restoredServer.getPendingSuggestionIds().length === pending.length,
    restoredServer.getPendingSuggestionIds(),
  );
  const restoredRecords = restoredServer.listSuggestions();
  check(
    "restored records keep authorship",
    restoredRecords.every((record) => record.authorType === "ai"),
    restoredRecords,
  );
  restoredServer.dispose();

  // Reject the removal, accept the rest, with a stale ID mixed in.
  const rejected = server.rejectSuggestions(third.suggestionIds!);
  check("rejectSuggestions resolves the removal", rejected.resolved.length === third.suggestionIds!.length, rejected);
  check("rejected removal restores the block", docText(ydoc).includes("Third reviewed sentence."));

  const decision = server.acceptSuggestions([...(first.suggestionIds ?? []), ...(second.suggestionIds ?? []), "stale-id"]);
  check("acceptSuggestions resolves remaining", decision.resolved.length === all.length - third.suggestionIds!.length, decision);
  check("stale ID lands in missing", decision.missing.includes("stale-id"), decision.missing);
  check("nothing unresolved", decision.unresolved.length === 0, decision.unresolved);
  check("accepted content applied", docText(ydoc).includes("1st reviewed sentence.") && docText(ydoc).includes("Suggested insertion."));
  check("queue is drained", server.getPendingSuggestionIds().length === 0);

  // Bulk paths.
  const bulk = await session("Bulk one.\n\nBulk two.", { mode: "suggesting" });
  const bulkIds = blockIds(bulk.ydoc);
  await bulk.server.tools.call("replace", {
    id: bulkIds[0]!,
    replacements: [{ find: "one", replace: "ONE", occurrence: "unique" }],
  });
  await bulk.server.tools.call("replace", {
    id: bulkIds[1]!,
    replacements: [{ find: "two", replace: "TWO", occurrence: "unique" }],
  });
  const rejectAll = bulk.server.rejectAllSuggestions();
  check("rejectAllSuggestions settles everything", rejectAll.resolved.length > 0 && bulk.server.getPendingSuggestionIds().length === 0, rejectAll);
  check("rejectAll restores original text", docText(bulk.ydoc).includes("Bulk one.") && !docText(bulk.ydoc).includes("ONE"));

  await bulk.server.tools.call("replace", {
    id: bulkIds[0]!,
    replacements: [{ find: "one", replace: "ONE", occurrence: "unique" }],
  });
  const acceptAll = bulk.server.acceptAllSuggestions();
  check("acceptAllSuggestions settles everything", acceptAll.resolved.length > 0 && docText(bulk.ydoc).includes("ONE"), acceptAll);
  bulk.server.dispose();

  // Suggesting-mode DOCX export carries tracked changes markup.
  const tracked = await session("Tracked export sentence.", { mode: "suggesting" });
  await tracked.server.tools.call("replace", {
    id: blockIds(tracked.ydoc)[0]!,
    replacements: [{ find: "Tracked", replace: "TRACKED", occurrence: "unique" }],
  });
  await mkdir(outputDirectory, { recursive: true });
  const trackedDocx = await ydocToDocx(tracked.ydoc);
  await writeFile(`${outputDirectory}/exercise-tracked.docx`, trackedDocx);
  // A .docx is a zip; the tracked-changes XML is DEFLATEd, so unzip the
  // document part before looking for revision markup.
  const { inflateRawSync } = await import("node:zlib");
  const trackedXml = extractZipEntry(trackedDocx, "word/document.xml", inflateRawSync);
  check("suggesting export emits <w:ins>/<w:del>", trackedXml.includes("<w:ins") && trackedXml.includes("<w:del"), trackedXml.slice(0, 0));
  tracked.server.dispose();

  server.dispose();
}

async function modeCaptureAndOverrides() {
  section("mode capture, queue & direct-mode overrides");

  const { ydoc, server } = await session("Alpha block.\n\nBeta block.");
  const [firstId, secondId] = blockIds(ydoc);

  // Mode captured at enqueue: toggle after submitting must not affect the call.
  server.setSuggestingMode();
  const queued = server.tools.call("replace", {
    id: firstId,
    replacements: [{ find: "Alpha", replace: "ALPHA", occurrence: "unique" }],
  });
  server.setEditingMode();
  const direct = server.tools.call("replace", {
    id: secondId,
    replacements: [{ find: "Beta", replace: "BETA", occurrence: "unique" }],
  });
  const [queuedResult, directResult] = await Promise.all([queued, direct]);
  check("call submitted in suggesting mode created a record", (queuedResult.suggestionIds?.length ?? 0) > 0, queuedResult.suggestionIds);
  check("call submitted in editing mode applied directly", directResult.suggestionIds?.length === 0 && server.getPendingSuggestionIds().length === (queuedResult.suggestionIds?.length ?? 0));

  server.acceptAllSuggestions();

  // Explicit overrides beat the session mode in both directions.
  server.setSuggestingMode();
  const forcedDirect = await server.tools.call(
    "replace",
    { id: firstId, replacements: [{ find: "ALPHA", replace: "Alpha2", occurrence: "unique" }] },
    { directMode: true },
  );
  check("directMode:true under suggesting applies directly", forcedDirect.suggestionIds?.length === 0 && docText(ydoc).includes("Alpha2"), forcedDirect.suggestionIds);

  server.setEditingMode();
  const forcedSuggest = await server.tools.call(
    "replace",
    { id: secondId, replacements: [{ find: "BETA", replace: "Beta2", occurrence: "unique" }] },
    { directMode: false },
  );
  check("directMode:false under editing creates a record", (forcedSuggest.suggestionIds?.length ?? 0) > 0, forcedSuggest.suggestionIds);
  server.rejectAllSuggestions();

  server.dispose();
}

/** Minimal stored/deflate zip reader: enough to pull one part out of a .docx. */
function extractZipEntry(
  zip: Uint8Array,
  wanted: string,
  inflateRaw: (buffer: Buffer) => Buffer,
): string {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let offset = 0;
  while (offset + 30 <= zip.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    if (name === wanted) {
      const raw = zip.subarray(dataStart, dataStart + compressedSize);
      return new TextDecoder().decode(
        method === 8 ? inflateRaw(Buffer.from(raw)) : raw,
      );
    }
    offset = dataStart + compressedSize;
  }
  return "";
}

async function runtimeHygiene() {
  section("runtime hygiene (console noise, unhandled rejections)");

  const warnings: string[] = [];
  const errors: string[] = [];
  const rejections: unknown[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);

  try {
    // Code blocks previously pulled browser-only tree-sitter wasm into Node.
    const md = "# T\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- a\n- b\n";
    const ydoc = await fileToYDoc(bytes(md), "hygiene.md");
    const server = await createServerDocumentSession(ydoc, { documentId: "hygiene" });
    const anchor = blockIds(ydoc)[0]!;
    await server.tools.call("insert_block", {
      referenceId: anchor,
      position: "after",
      content: ["<table><tr><td>Q</td><td>R</td></tr></table>", "<ul><li>li</li></ul>"],
    });
    await ydocToDocx(ydoc);
    server.dispose();
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    process.off("unhandledRejection", onRejection);
  }

  check("no console.warn noise from server operations", warnings.length === 0, warnings.slice(0, 3));
  check("no console.error noise from server operations", errors.length === 0, errors.slice(0, 3));
  check("no unhandled promise rejections", rejections.length === 0, rejections.slice(0, 1).map(String));
}

async function main() {
  await conversionAndPersistence();
  await sessionLifecycle();
  await readAndSearch();
  await measurement();
  await textMutations();
  await structureAndStyle();
  await footnotes();
  await tables();
  await comments();
  await suggestingAndReview();
  await modeCaptureAndOverrides();
  await runtimeHygiene();

  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (error instanceof ReviseToolError) {
    console.error(`Unexpected tool failure: ${error.tool} (${error.code}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
