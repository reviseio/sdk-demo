# Revise SDK Demo App

A contract-review workbench built on `@reviseio/sdk`, written exactly as an
outside integrator would write one: the SDK is installed from the private
registry at a pinned version, and nothing here imports Revise source. The
SDK is **not** committed to this repository — cloning it gets you the app;
building it requires access.

## Getting access

`@reviseio/sdk` is a private package. You need a registry token from Revise
(see [sdk.revise.io/access](https://sdk.revise.io/access), or the onboarding
email that came with your evaluation).

```bash
cp .npmrc.example .npmrc      # then paste your token in
npm install
npm run dev                   # http://localhost:4321
```

Prefer keeping credentials out of the repo directory entirely? Put the same
two lines in your user-level `~/.npmrc` instead — `.npmrc` is gitignored
here either way, and must never be committed.

`npm install` failing with a **404** is npm's way of saying 403: the scope
is not routed to the registry, or your token is not being read. Nothing else
in this app needs credentials — no backend, no accounts, no network at
runtime.

## What it showcases

| Surface | Where |
| --- | --- |
| Opening documents (Markdown source, format inferred from the filename) | `src/sampleDocument.ts` |
| Multi-document sessions and the host's own tab strip | header tabs, `documents.open/activate/subscribe` |
| The SDK's native formatting ribbon (default) plus a host-owned toolbar above it: mode toggle, markup views, zoom, live word count | `src/HostToolbar.tsx` — `handle.toolbar` / `view` / `review` / `zoom` / `getStatistics()` |
| Editing ⇄ Suggesting document modes | toolbar "Mode" toggle — `view.setDocumentMode()` |
| Markup views (All markup / Final / Original) + show removals | toolbar "Markup" — `review.setSuggestionViewMode()` / `setShowRemovals()` |
| Revise-style vs Word-style tracked-change rendering | toolbar "Style" — `settings.trackedChanges.markupStyle` |
| Light / dark / system theming, applied to shell AND editor | toolbar "Theme" — the SDK `theme` prop |
| Tracked changes with a custom review panel | `src/panels/ChangesPanel.tsx` — `review.listChanges()` |
| Comments: create, reply, resolve, accept related changes | `src/panels/CommentsPanel.tsx` |
| **Every agent tool, via generated forms** | `src/panels/ToolConsole.tsx` — pick any of the ~27 tools, fill a form generated from its JSON `inputSchema`, run it, read the result |
| Roles: editor / suggest-only / viewer, enforced | header role picker |
| Selection observation with block IDs, capture and restore | `src/panels/SelectionPanel.tsx` |
| Presence roster | `src/panels/PresencePanel.tsx` |
| DOCX export | header "Export .docx" |
| Collaboration over a host-owned Yjs transport | `src/loopbackTransport.ts` — **see below** |

The document opens in `suggesting` mode, so typing anywhere produces tracked
changes that appear in the Changes panel with author, timestamp, and text.

The tool console is the fastest way to feel the agent surface: the forms are
generated from the same JSON schemas you would hand your model, they run
with no server, and with direct mode off every mutation lands as a tracked
change. The Selection panel shows the block IDs tools address.

## One copy of Yjs

Yjs identifies its own types with `instanceof`, so this app and the SDK must
resolve to the same Yjs module. `yjs` and `y-protocols` are peer dependencies,
installed here directly, and `vite.config.ts` keeps them and the SDK on the
same side of the dependency optimiser:

```ts
resolve: { dedupe: ["yjs", "y-protocols"] },
optimizeDeps: { exclude: ["@reviseio/sdk", "yjs", "y-protocols"] },
```

Get this wrong and seeding a shared document fails with `Unexpected content
type in insert operation`.

## Notes for whoever picks this up

**`onReady` fires before the first document exists.** Subscriptions placed
then are fine — they wait and attach when a document arrives — but anything
that *acts* on a document throws until one is open. This app takes the
handle in `onReady` and publishes it in `onDocumentReady`, which is the
pattern worth copying. `await editor.whenReady()` does the same job outside
React.

**The collaboration demo is in-memory.** `src/loopbackTransport.ts` relays
between two peers in the same tab, so there is no server to run. A real
integration passes a Hocuspocus or y-websocket provider instead and the SDK
treats it identically — ask Revise for the `collaborative-docx` example,
which includes a server that converts and persists.

**URL flags**: `?headless=1` hides the SDK's native ribbon to demo a fully
host-owned chrome; `?word=1` starts in Word-style markup.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.
One-time setup: **Settings → Pages → Source: GitHub Actions**, and add a
repository secret **`REVISE_NPM_TOKEN`** holding an npm token that can read
`@reviseio/sdk`. Any repo name works — the site lands at
`https://<owner>.github.io/<repo>/`, and the workflow derives the base path
from the repo name.

Note that a public Pages site serves the compiled SDK bundle to anyone who
opens it — the same as any deployed web app, but worth being deliberate
about.
