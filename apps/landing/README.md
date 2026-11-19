# Calistar landing page

Next.js 16 App Router landing page. Static, no database.

## Routing to the other apps

Set in `next.config.ts`. Both variables are read at build time, so redeploy after changing one. Set them in the Vercel project (**Settings → Environment Variables**), or in `.env.local` for local work.

| Variable | Effect | Default |
| --- | --- | --- |
| `DOCS_ORIGIN` | `/docs/*` is proxied (rewrite) to this origin, the production domain of the docs Vercel project (`apps/docs`). Unset, `/docs` returns 404. | unset |
| `CONSOLE_URL` | `/console/*` redirects to this URL. Unset, the route does not exist. | unset |

`/docs` is a rewrite, so the address bar stays on `calistar.io`. `/console` is a redirect, because the console keeps its own domain and hosting.

## Run locally

From the repository root:

```bash
pnpm install
pnpm dev --filter @calistar/landing
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy on Vercel

1. Push the repository to GitHub.
2. In Vercel: **Add New → Project → Import** repository.
3. Set **Root Directory** to `apps/landing`. Keep default framework preset: **Next.js**.
4. Click **Deploy**.
5. In project **Settings → Domains**, add `calistar.io` then `www.calistar.io`.
6. Vercel shows exact DNS records. Add those records in OVH.
7. In Vercel, set `calistar.io` as primary domain. Redirect `www` to apex.

## DNS with OVH

Keep OVH nameservers. Do not change nameservers unless moving every DNS record to Vercel.

Add domain in Vercel first. Then copy Vercel’s exact A/CNAME/TXT values into OVH’s DNS Zone. Common values can differ by Vercel project, so Vercel dashboard is source of truth.

After propagation, Vercel automatically issues HTTPS certificate.
