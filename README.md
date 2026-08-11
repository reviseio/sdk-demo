# Revise SDK Demo App

A standalone React demo of the [Revise SDK](https://revise.io/sdk)

[Live Demo](https://reviseio.github.io/sdk-demo/) | [SDK Documentation](https://sdk.revise.io)

## Run locally

You need Node.js 18 or newer and the read-only npm token supplied with your
Revise SDK evaluation.

```bash
cp .npmrc.example .npmrc
export REVISE_NPM_TOKEN=npm_your_token_here
npm ci
npm run dev
```

Open [http://localhost:4321](http://localhost:4321).

To see the client and backend working together, also start the demo's Node
service in a second terminal:

```bash
npm run server
```

Then open the **Backend** panel in the app's right-hand rail. The panel posts
the live collaborative document to the service (a stateless HTTP server built
on `@reviseio/sdk/backend`, in [`server/`](server/index.ts)), which runs the
same semantic tools headlessly and answers with a CRDT delta:

- **Run review** — a canned server-side "counsel pass" that tightens wordy
  phrasing as tracked changes and comments on the longest paragraph. The
  response carries the created suggestion IDs, so the panel can accept or
  reject exactly that batch while the Changes panel shows each one.
- **Server find & replace** — the same edit in either posture: pending
  suggestions or direct application.
- **Measure / Server export** — server-side document stats and .docx
  rendering.

Because both sides speak Yjs, the server's edits merge into the open editor
like a collaborator's — even if you keep typing during the round-trip. On the
static GitHub Pages deployment there is no server; the panel detects that and
explains how to run locally. (A future full-stack deployment would host
`server/` alongside the static build and point the `/api` proxy at it.)

To create a production build:

```bash
npm run build
```

## Backend semantic editing

[`examples/backend-semantic-editing.ts`](examples/backend-semantic-editing.ts)
is a self-contained Node example using the SDK's headless document tools. It:

- creates a Yjs document from Markdown;
- finds and edits a clause with typed semantic tools;
- switches between direct editing and tracked suggestions;
- collects the created suggestion IDs from the mutation result, inspects
  pending records with `listSuggestions()`, and accepts them by ID with a
  per-ID outcome; and
- exports DOCX and persisted Yjs artifacts.

Run it with:

[`examples/backend-full-exercise.ts`](examples/backend-full-exercise.ts) is an
exhaustive harness covering every backend export and all 24 semantic tools in
both modes — 106 assertions over conversion, reads, search, measurement, every
mutation tool, footnotes, tables, comments, the suggestion review lifecycle,
and runtime hygiene (no console noise, no unhandled rejections). Run it with
`npm run exercise:backend`.

```bash
npm run check:backend
npm run demo:backend
```

Generated files are written to `examples/output/` and ignored by Git. In an
application server, replace the embedded Markdown with uploaded bytes or a
stored Yjs update; the editing API is unchanged.

See the [Revise SDK documentation](https://sdk.revise.io) for integration,
authentication, and deployment guidance.
