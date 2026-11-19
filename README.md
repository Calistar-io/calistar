# Calistar

Privacy-first web and API analytics for Stellar ecosystem projects. Monorepo managed with [Turborepo](https://turborepo.dev) and pnpm workspaces.

## Layout

```text
apps/
  landing/     Landing page (Next.js 16)
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
