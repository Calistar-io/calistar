# Calistar landing page

Next.js 16 App Router landing page. Static, no database, no environment variables.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy on Vercel

1. Push this folder to a new GitHub repository.
2. In Vercel: **Add New → Project → Import** repository.
3. Keep default framework preset: **Next.js**.
4. Click **Deploy**.
5. In project **Settings → Domains**, add `calistar.io` then `www.calistar.io`.
6. Vercel shows exact DNS records. Add those records in OVH.
7. In Vercel, set `calistar.io` as primary domain. Redirect `www` to apex.

## DNS with OVH

Keep OVH nameservers. Do not change nameservers unless moving every DNS record to Vercel.

Add domain in Vercel first. Then copy Vercel’s exact A/CNAME/TXT values into OVH’s DNS Zone. Common values can differ by Vercel project, so Vercel dashboard is source of truth.

After propagation, Vercel automatically issues HTTPS certificate.
