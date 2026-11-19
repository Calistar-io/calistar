# Calistar

Privacy-first web and API analytics for Stellar ecosystem projects. Monorepo managed with [Turborepo](https://turborepo.dev) and pnpm workspaces.

## Layout

```text
apps/
  landing/     Landing page (Next.js 16), served at calistar.io
  docs/        Documentation (VitePress), served at calistar.io/docs
packages/      Shared packages (none yet)
```

## Requirements

- Node.js 22 or later
- pnpm 12 (`corepack enable` picks the version pinned in `package.json`)

## Commands

Run from the repository root:

```bash
pnpm install
pnpm dev          # start every app in development mode
pnpm build        # build every app
pnpm typecheck    # type-check every workspace
```

To run one workspace only, add a filter: `pnpm dev --filter @calistar/landing`.

## How the apps share one domain

`apps/landing` and `apps/docs` are two Vercel projects. The landing owns `calistar.io` and proxies `/docs` to the docs project (its domain is read from `DOCS_ORIGIN`) with a rewrite in `apps/landing/next.config.ts`, so the documentation is read at `calistar.io/docs`. Setup steps are in [apps/docs/README.md](apps/docs/README.md).

The console does not exist yet and will not be hosted on Vercel. The landing redirects `/console` to it once `CONSOLE_URL` is set.
