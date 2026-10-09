import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ReviseDocument } from "revise";

const source = `# Mutual NDA

This Mutual Non-Disclosure Agreement is between Acme Corp. and Northstar Labs.

## Permitted disclosures

Recipient may disclose Confidential Information to employees who need it to evaluate the proposed partnership.

## Governing law

This Agreement is governed by the laws of Delaware.
`;

const outputDirectory = fileURLToPath(new URL("./output/", import.meta.url));

/** A tool result's value. Tools return `{ ok, value | error }` and never
 * throw for a bad edit; this example treats a failure as fatal. */
function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });

  // Open a host-owned file as the same Y.Doc the browser editor uses. A
  // service proposes tracked changes unless it opts into direct edits.
  const document = await ReviseDocument.open(
    { bytes: new TextEncoder().encode(source), filename: "mutual-nda.md" },
    { mode: "suggesting", author: "Contract service" },
  );

  try {
    const initial = unwrap(await document.tools.call("measure_document"));
    console.log(
      `Loaded ${initial.data.wordCount} words in ${initial.data.totalBlocks} blocks.`,
    );

    // Housekeeping edits can opt into direct application per call (or via
    // setMode). This one applies immediately: no tracked records.
    const disclosure = unwrap(
      await document.tools.call("search_document", {
        queries: ["Recipient may disclose Confidential Information"],
        page: 0,
        context_notes: "Narrow the permitted-disclosure clause.",
      }),
    );
    if (!disclosure.data.search_result_id) {
      throw new Error("The permitted-disclosure clause was not found.");
    }
    const housekeeping = unwrap(
      await document.tools.call(
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
      ),
    );
    console.log(
      `Direct edit created ${housekeeping.suggestionIds?.length ?? 0} tracked records.`,
    );

    // Back on the default posture, this edit lands as a reviewable change.
    const governingLaw = unwrap(
      await document.tools.call("search_document", {
        queries: ["laws of Delaware"],
        page: 0,
        context_notes: "Propose New York as the governing law.",
      }),
    );
    if (!governingLaw.data.search_result_id) {
      throw new Error("The governing-law clause was not found.");
    }
    const edit = unwrap(
      await document.tools.call("replace", {
        search_result_id: governingLaw.data.search_result_id,
        replacements: [{ find: "Delaware", replace: "New York" }],
      }),
    );

    // Mutation results report the tracked records they created. Persist these
    // IDs with your review task: they are the handle for accept/reject later.
    const created = edit.suggestionIds ?? [];
    console.log(`The replace call created ${created.length} tracked record(s).`);

    // Or inspect everything pending. Changes carry their author, so a host
    // can decide on its own agent's suggestions and leave collaborators' alone.
    for (const change of await document.changes()) {
      console.log(`Pending: ${change.id} by ${change.author} (${change.type})`);
    }

    const withSuggestion = await document.export({ format: "docx" });
    await writeFile(
      `${outputDirectory}/mutual-nda-with-suggestion.docx`,
      withSuggestion.bytes,
    );

    // Accept by ID: the primary path. The result is per ID: `resolved` holds
    // what settled, `missing` reports stale IDs (a later suggestion can
    // supersede an earlier one). `accept({ all: true })` settles everything.
    const decision = await document.accept({ ids: created });
    console.log(
      `Accepted ${decision.resolved.length} record(s); ${decision.missing.length} missing.`,
    );

    await document.setMode("editing");
    const final = await document.export({ format: "docx" });
    await Promise.all([
      writeFile(`${outputDirectory}/mutual-nda-final.docx`, final.bytes),
      // The complete state, restorable with ReviseDocument.restore().
      writeFile(`${outputDirectory}/mutual-nda-final.revise`, await document.snapshot()),
    ]);

    const measured = unwrap(await document.tools.call("measure_document"));
    console.log(`Final document has ${measured.data.wordCount} words.`);
    console.log(`Wrote artifacts to ${outputDirectory}`);
  } finally {
    document.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
