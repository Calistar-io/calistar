# Calistar docs

Source of the public documentation, a [VitePress](https://vitepress.dev) site (`1.6.4`) served at `https://calistar.io/docs`.

This file is for maintainers. It is not part of the site (`srcExclude` in `.vitepress/config.ts`).

## Sections

| Section (nav) | Directory | Reader |
| --- | --- | --- |
| Architecture | `architecture/` | Reviewers, contributors |
| Builders | `tenants/` | Projects that enroll |
| Operators | `operators/` | SCF operators, the future community operator |
| Security | `security/` | Reviewers, projects |
| Privacy | `privacy/` | Reviewers, projects |

The home page is `index.md`. Diagrams are static SVGs in `public/images/`. A new page is added to the sidebar by hand, in `.vitepress/config.ts`.

Calistar is at the proposal stage: a page says so in a `::: warning Draft` block and never describes planned work as running.

## Run locally

From the repository root:

```bash
pnpm install
pnpm dev --filter @calistar/docs     # http://localhost:5173/docs/
pnpm build --filter @calistar/docs   # output in apps/docs/.vitepress/dist
```

## Look and feel

`.vitepress/theme/custom.css` maps the landing's tokens (`apps/landing/app/globals.css`) onto VitePress variables: same colours, same font stacks, square corners, ink borders, mono labels. It is CSS only, on top of the default theme. There is no dark mode, as on the landing. When a token changes on the landing, change it here too.

## Serving under /docs

The site is its own Vercel project. The landing proxies `/docs` to it, so both share `calistar.io`.

- `base: '/docs/'` in `.vitepress/config.ts`: every link and asset URL starts with `/docs/`.
- `vercel.json` here rewrites `/docs/:path*` to `/:path*`, so the project answers both at its root (what the landing's proxy asks for) and under `/docs` (its own domain).
- `apps/landing/next.config.ts` rewrites `/docs/:path*` to this project's production domain, read from `DOCS_ORIGIN`.

### Vercel setup (once)

1. **Add New → Project**, import the same repository.
2. Name it `calistar-docs`. Set **Root Directory** to `apps/docs`. The framework preset (VitePress) and the output directory come from `vercel.json`.
3. Deploy, then open `https://<project domain>/docs/` to check the site on its own.
4. On the **landing** project, set the environment variable `DOCS_ORIGIN` to this project's production domain (for example `https://calistar-docs.vercel.app`, as shown under **Settings → Domains**), then redeploy the landing.
5. Open `https://calistar.io/docs`.

Point the rewrite at the production domain, which follows every deploy of `main`. A manually assigned alias stays on the build it was assigned to.

Canonical and Open Graph URLs always point to `https://calistar.io/docs`, never to the `*.vercel.app` host.
