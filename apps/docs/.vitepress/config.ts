import { defineConfig } from 'vitepress'

// The public origin: canonical and Open Graph tags point to it, never to the *.vercel.app host.
const SITE = 'https://calistar.io'
const DOCS = `${SITE}/docs`
const description =
  'Documentation for Calistar: privacy-first web and API analytics for Stellar ecosystem projects.'

const SECTIONS = [
  { text: 'Architecture', link: '/architecture/' },
  { text: 'Builders', link: '/tenants/' },
  { text: 'Operators', link: '/operators/' },
  { text: 'Security', link: '/security/' },
  { text: 'Privacy', link: '/privacy/' },
]

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Calistar',
  titleTemplate: ':title | Calistar docs',
  description,
  lang: 'en-US',
  // Served under /docs of calistar.io through a rewrite in apps/landing/next.config.ts
  base: '/docs/',
  cleanUrls: true,
  // The landing has one palette, a light one: no dark mode here either
  appearance: false,
  srcExclude: ['README.md'],

  // Code blocks use the landing's dark panel (--panel in theme/custom.css)
  markdown: { theme: 'github-dark' },

  sitemap: { hostname: `${DOCS}/` },

  transformPageData(pageData) {
    const canonical = `${DOCS}/${pageData.relativePath}`
      .replace(/index\.md$/, '')
      .replace(/\.md$/, '')
    const isHome = pageData.relativePath === 'index.md'

    if (isHome) {
      // The home title would otherwise render "Calistar | Calistar docs"
      pageData.titleTemplate = false
      pageData.title = 'Calistar docs: web and API analytics for Stellar projects'
    }

    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { property: 'og:title', content: pageData.title }],
      ['meta', { property: 'og:description', content: pageData.frontmatter.description ?? description }],
      ['meta', { property: 'og:url', content: canonical }],
    )
  },

  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Calistar' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/docs/favicon.svg' }],
  ],

  themeConfig: {
    logo: { src: '/logo.svg', alt: '' },
    siteTitle: 'Calistar',

    nav: [
      // activeMatch keeps a section highlighted on every page of it
      ...SECTIONS.map(({ text, link }) => ({ text, link, activeMatch: `^${link}` })),
      // An absolute URL: a "/" link would get the /docs/ base. Same tab, it is the same site.
      { text: 'calistar.io', link: SITE, target: '_self', rel: '', noIcon: true },
    ],

    sidebar: [
      { text: 'Understand', items: [{ text: 'Architecture overview', link: '/architecture/' }] },
      {
        text: 'Use',
        items: [
          { text: 'For builders', link: '/tenants/' },
          { text: 'For operators', link: '/operators/' },
        ],
      },
      {
        text: 'Trust',
        items: [
          { text: 'Security', link: '/security/' },
          { text: 'Privacy', link: '/privacy/' },
        ],
      },
    ],

    outline: { level: [2, 3], label: 'On this page' },
    search: { provider: 'local' },

    footer: {
      message: 'Calistar is a proposal. Nothing described in these docs is running yet.',
      copyright: 'Proposed open-source infrastructure · 2026',
    },
  },
})
