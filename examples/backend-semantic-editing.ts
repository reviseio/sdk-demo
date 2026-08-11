import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  ReviseToolError,
  createServerDocumentSession,
  encodeYDoc,
  fileToYDoc,
  ydocToDocx,
} from "@reviseio/sdk/backend";

const source = `# Mutual NDA

This Mutual Non-Disclosure Agreement is between Acme Corp. and Northstar Labs.

## Permitted disclosures

Recipient may disclose Confidential Information to employees who need it to evaluate the proposed partnership.

## Governing law

This Agreement is governed by the laws of Delaware.
`;

const outputDirectory = fileURLToPath(new URL("./output/", import.meta.url));

async function main() {
  await mkdir(outputDirectory, { recursive: true });

  // Convert a host-owned file into the same Y.Doc the browser editor uses.
  const ydoc = await fileToYDoc(
    new TextEncoder().encode(source),
    "mutual-nda.md",
  );
  // Sessions default to suggesting mode — a service proposes tracked
  // changes unless it explicitly opts into direct edits.
  const document = await createServerDocumentSession(ydoc, {
    documentId: "mutual-nda",
  });

  try {
    const initial = await document.tools.call("measure_document");
    console.log(
      `Loaded ${initial.data.wordCount} words in ${initial.data.totalBlocks} blocks.`,
    );

    // Housekeeping edits can opt into direct application per call (or via
    // setEditingMode). This one applies immediately: no tracked records.
    const disclosure = await document.tools.call("search_document", {
      queries: ["Recipient may disclose Confidential Information"],
      page: 0,
      context_notes: "Narrow the permitted-disclosure clause.",
    });
    if (!disclosure.data.search_result_id) {
      throw new Error("The permitted-disclosure clause was not found.");
    }
    const housekeeping = await document.tools.call(
      "replace",
      {
        search_result_id: disclosure.data.search_result_id,
        replacements: [
          {
            find: "employees who need it",
            replace: "employees and professional advisers who need it",
          },
        ],
      },
      { directMode: true },
    );
    console.log(
      `Direct edit created ${housekeeping.suggestionIds?.length ?? 0} tracked records.`,
    );

    // Back on the default posture, this edit lands as a reviewable change.
    const governingLaw = await document.tools.call("search_document", {
      queries: ["laws of Delaware"],
      page: 0,
      context_notes: "Propose New York as the governing law.",
    });
    if (!governingLaw.data.search_result_id) {
      throw new Error("The governing-law clause was not found.");
    }
    const edit = await document.tools.call("replace", {
      search_result_id: governingLaw.data.search_result_id,
      replacements: [{ find: "Delaware", replace: "New York" }],
    });

    // Mutation results report the tracked records they created. Persist these
    // IDs with your review task — they are the handle for accept/reject later.
    const created = edit.suggestionIds ?? [];
    console.log(`The replace call created ${created.length} tracked record(s).`);

    // Or inspect everything pending. Records carry authorship, so a host can
    // decide on its own agent's suggestions and leave collaborators' alone.
    for (const record of document.listSuggestions()) {
      console.log(
        `Pending: ${record.id} by ${record.agentName ?? "unknown"} (${record.authorType ?? "?"})`,
      );
    }

    await writeFile(
      `${outputDirectory}/mutual-nda-with-suggestion.docx`,
      await ydocToDocx(ydoc),
    );

    // Accept by ID — the primary path. The result is per-ID: `resolved` holds
    // what settled, `missing` reports stale IDs (a later suggestion can
    // supersede an earlier one) instead of leaving you to infer from a count.
    // (`acceptAllSuggestions()` exists for hosts that own the whole document.)
    const decision = document.acceptSuggestions(created);
    console.log(
      `Accepted ${decision.resolved.length} record(s); ${decision.missing.length} missing.`,
    );

    document.setEditingMode();
    await Promise.all([
      writeFile(`${outputDirectory}/mutual-nda-final.docx`, await ydocToDocx(ydoc)),
      writeFile(`${outputDirectory}/mutual-nda-final.yjs`, encodeYDoc(ydoc)),
    ]);

    const final = await document.tools.call("measure_document");
    console.log(`Final document has ${final.data.wordCount} words.`);
    console.log(`Wrote artifacts to ${outputDirectory}`);
  } finally {
    // Releases Revise observers; the host still owns ydoc.
    document.dispose();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ReviseToolError) {
    console.error(`${error.tool} failed (${error.code}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
