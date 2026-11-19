import type { NextConfig } from "next";

const trimSlash = (url: string) => url.replace(/\/+$/, "");

// VitePress docs (apps/docs): a separate Vercel project proxied under /docs, so the docs share
// the landing's domain. DOCS_ORIGIN is that project's PRODUCTION domain, which follows every
// deploy of its main branch. There is no default on purpose: a guessed *.vercel.app name can
// belong to someone else, and /docs would then serve their site. Unset, /docs does not exist.
const docsOrigin = process.env.DOCS_ORIGIN ? trimSlash(process.env.DOCS_ORIGIN) : undefined;

// The console is not hosted on Vercel and its domain is not chosen yet. /console redirects to it
// only once CONSOLE_URL is set; until then the route does not exist.
const consoleUrl = process.env.CONSOLE_URL ? trimSlash(process.env.CONSOLE_URL) : undefined;

const nextConfig: NextConfig = {
  // The docs build links pages with a trailing slash (/docs/architecture/): pass them through as is.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    if (!docsOrigin) return [];
    return [{ source: "/docs/:path*", destination: `${docsOrigin}/:path*` }];
  },
  async redirects() {
    if (!consoleUrl) return [];
    // A redirect, not a rewrite: the console keeps its own domain, sessions and hosting.
    return [{ source: "/console/:path*", destination: `${consoleUrl}/:path*`, permanent: false }];
  },
};

export default nextConfig;
