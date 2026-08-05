# Revise SDK Demo App

A standalone React demo of `@reviseio/sdk`. The SDK is installed from Revise's
private npm package and is not committed to this repository.

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

To create a production build:

```bash
npm run build
```

See the [Revise SDK documentation](https://sdk.revise.io) for integration,
authentication, and deployment guidance.
