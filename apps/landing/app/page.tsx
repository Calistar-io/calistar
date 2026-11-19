const principles = [
  "Usage data, not personal data.",
  "One shared service, not a black box.",
  "Verified numbers, not self-reported.",
];

const metrics = [
  ["01", "Reach", "Page views, privacy-respecting unique visitors, referrers, and session duration."],
  ["02", "Experience", "Bounce rate, country-level geography, browser, and device breakdown."],
  ["03", "Reliability", "Request volume, success and error rates, plus p50 and p95 API latency."],
  ["04", "Stewardship", "Global comparison for designated operators, tenant boundaries intact."],
];

const scfEvidence = [
  {
    title: "Lendwise · SCF #45",
    description: "Dashboards, APIs, data pipelines, and open-source delivery.",
    href: "https://communityfund.stellar.org/submissions/recmK8tdxCKvSU3GS",
  },
  {
    title: "MUWPAY · SCF #35",
    description: "Full-stack engineering contribution to an awarded Stellar SDK.",
    href: "https://communityfund.stellar.org/submissions/recmvpMI0UZ6fy1ab",
  },
];

function Brand() {
  return (
    <span className="brand">
      <span className="brandMark" aria-hidden="true"><i /><b /></span>
      <span>Calistar</span>
    </span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow"><span />{children}</p>;
}

export default function Home() {
  return (
    <>
      <div className="starfield" aria-hidden="true" />
      <header className="siteHeader container">
        <a href="#top" aria-label="Calistar home"><Brand /></a>
        <nav aria-label="Main navigation">
          <a href="#approach">Approach</a>
          <a href="#architecture">Architecture</a>
          <a href="#metrics">Metrics</a>
          <a href="#team">Team</a>
          <a href="/docs">Docs</a>
        </nav>
        <a className="headerLink" href="#brief">Project brief <span>↗</span></a>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="heroCopy">
            <Eyebrow>Shared infrastructure for the Stellar ecosystem</Eyebrow>
            <h1>Make real usage<br /><em>visible.</em> Keep users private.</h1>
            <p className="lede">
              Calistar is a proposed open-source service that measures web and API usage across Stellar projects, without collecting personal data.
            </p>
            <div className="heroActions">
              <a className="button buttonPrimary" href="#approach">Explore Calistar <span>↓</span></a>
              <a className="button buttonQuiet" href="#brief">Read project brief</a>
            </div>
            <div className="heroNotes">
              <span>WEB + API</span><span>OPEN SOURCE</span><span>PRIVACY FIRST</span>
            </div>
          </div>

          <div className="heroArt" role="img" aria-label="Protected signals orbiting a shared Stellar ecosystem view">
            <div className="orb orbA" /><div className="orb orbB" /><div className="orb orbC" />
            <div className="axis" /><div className="core"><span /></div>
            <div className="signal signalA" /><div className="signal signalB" /><div className="signal signalC" />
            <div className="orbitLabel labelA">TENANT<br />SIGNALS</div>
            <div className="orbitLabel labelB">SCF<br />VIEW</div>
            <div className="metricChip chipA"><small>API LATENCY</small><strong>p95</strong></div>
            <div className="metricChip chipB"><small>WEB USAGE</small><strong>● ● ●</strong></div>
          </div>
        </section>

        <section className="signalStrip" aria-label="Calistar principles">
          <div className="container stripGrid">
            {principles.map((principle) => <p key={principle}>{principle}</p>)}
          </div>
        </section>

        <section className="container section" id="approach">
          <div className="sectionHeading">
            <Eyebrow>One trusted view</Eyebrow>
            <h2>Real adoption data,<br />without the burden.</h2>
          </div>
          <div className="approachGrid">
            <article className="approachCard webCard">
              <div className="cardNumber">01</div>
              <div className="miniBrowser" aria-hidden="true">
                <div className="browserTop"><i /><i /><i /><b /></div>
                <div className="browserChart">
                  <span /><span /><span /><span /><span />
                  <svg viewBox="0 0 280 110" preserveAspectRatio="none"><path d="M0,78 C25,78 28,56 48,61 S74,86 94,53 S121,42 142,51 S170,24 190,35 S217,17 237,29 S261,7 280,12" /></svg>
                </div>
              </div>
              <h3>Web analytics · Umami</h3>
              <p>Version-pinned frontend script: page views, visitors, referrers, session duration, bounce rate, country, browser, device.</p>
            </article>

            <article className="approachCard apiCard">
              <div className="cardNumber">02</div>
              <div className="apiLines" aria-hidden="true">
                <div><b>POST</b><span>/metrics</span><em>202</em></div>
                <div><b>GET</b><span>/v1/summary</span><em>200</em></div>
                <div><b>GET</b><span>/v1/routes</span><em>200</em></div>
                <div><b>POST</b><span>/collect</span><em>202</em></div>
              </div>
              <h3>API analytics</h3>
              <p>Dual-exported OpenTelemetry metrics become request volume, status distribution, and latency percentiles. Traces, spans, and deep logs stay out.</p>
            </article>

            <article className="approachCard scfCard">
              <div className="cardNumber">03</div>
              <div className="compareBars" aria-hidden="true"><span /><span /><span /><span /></div>
              <h3>Shared ecosystem view</h3>
              <p>Projects see only their own data. Designated SCF operators compare standardized metrics across enrolled projects.</p>
            </article>
          </div>
        </section>

        <section className="architectureWrap" id="architecture">
          <div className="container section architecture">
            <div className="sectionHeading narrow">
              <Eyebrow>Designed for handover</Eyebrow>
              <h2>Infrastructure<br />the community can run.</h2>
              <p className="sectionCopy">Code, infrastructure, docs, and runbooks, all open source and in one place.</p>
              <p className="stackLine">NEXT.JS · TYPESCRIPT · UMAMI · OPENTELEMETRY · POSTGRESQL</p>
            </div>
            <div className="diagram" aria-label="Architecture diagram from tenant properties to protected metrics and separate tenant and SCF views">
              <div className="diagramColumn sources">
                <p>PROJECTS</p>
                <div className="node"><i className="siteIcon">⌁</i><span>Web properties</span></div>
                <div className="node"><i className="apiIcon">{"{}"}</i><span>Application APIs</span></div>
              </div>
              <div className="diagramLink"><span /><b>VERSIONED SNIPPET<br />OTEL EXPORT</b></div>
              <div className="diagramColumn process">
                <p>CALISTAR CORE</p>
                <div className="processNode"><i>01</i><span>Privacy filtering<br /><small>Drop excess payloads</small></span></div>
                <div className="processNode"><i>02</i><span>Metric normalization<br /><small>Routes, status, latency</small></span></div>
                <div className="processNode"><i>03</i><span>PostgreSQL aggregates<br /><small>Operational metrics only</small></span></div>
              </div>
              <div className="diagramLink out"><span /><b>ROLE-BASED<br />ACCESS</b></div>
              <div className="diagramColumn views">
                <p>VIEWS</p>
                <div className="viewNode tenant"><span>Tenant dashboard</span><small>Own data only</small></div>
                <div className="viewNode global"><span>SCF operator view</span><small>Global comparison</small></div>
              </div>
            </div>
          </div>
        </section>

        <section className="container section metricsSection" id="metrics">
          <div className="sectionHeading">
            <Eyebrow>Comparable by design</Eyebrow>
            <h2>Metrics that answer<br />real adoption questions.</h2>
          </div>
          <div className="metricsGrid">
            {metrics.map(([number, title, description]) => (
              <article className="metric" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container teamSection" id="team">
          <div className="teamIntro">
            <Eyebrow>Project lead & delivery evidence</Eyebrow>
            <h2>Built by a known<br />SCF contributor.</h2>
            <p>
              <strong>Cédric Magne</strong> is a full-stack engineer with prior
              Stellar Community Fund delivery experience. Calistar draws on work
              across dashboards, APIs, data pipelines, and open-source delivery.
            </p>
            <div className="teamLinks">
              <a className="button buttonPrimary" href="https://github.com/cedricmagne" target="_blank" rel="noreferrer">
                GitHub profile <span>↗</span>
              </a>
              <a className="button buttonQuiet" href="https://www.linkedin.com/in/cedricmagne/" target="_blank" rel="noreferrer">
                LinkedIn profile <span>↗</span>
              </a>
              <a className="button buttonQuiet" href="/docs">Read the docs</a>
            </div>
          </div>
          <div className="evidenceList">
            <p className="evidenceLabel">SCF DELIVERY HISTORY</p>
            {scfEvidence.map((item) => (
              <a className="evidenceCard" href={item.href} target="_blank" rel="noreferrer" key={item.title}>
                <span>{item.title}</span>
                <p>{item.description}</p>
                <b>View awarded project ↗</b>
              </a>
            ))}
            <p className="teamNote">
              Lendwise SCF #45 and MUWPAY SCF #35 each completed all three grant tranches.
            </p>
          </div>
        </section>

        <section className="container privacyPanel" id="brief">
          <div>
            <Eyebrow>Privacy is architecture</Eyebrow>
            <h2>Measure services.<br />Not people.</h2>
          </div>
          <div className="privacyList">
            <p><i>✓</i>Frontend-only web collection</p>
            <p><i>✓</i>Tenant-isolated access</p>
            <p><i>✓</i>API metric aggregation</p>
            <p><i>✓</i>Open operational documentation</p>
          </div>
          <p className="panelNote">Calistar is a proposal responding to Stellar Community Fund’s Web and API Analytics RFP. Implementation, data-residency choices, and operational commitments remain subject to approved scope.</p>
        </section>
      </main>

      <footer className="container siteFooter">
        <a href="#top"><Brand /></a>
        <p>Privacy-first web and API analytics for Stellar ecosystem projects.</p>
        <p><a href="/docs">Documentation</a> · Proposed open-source infrastructure · 2026</p>
      </footer>
    </>
  );
}
