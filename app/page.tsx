const principles = [
  "Usage signals, not surveillance.",
  "Shared service, not a black box.",
  "Evidence, not self-reported claims.",
];

const metrics = [
  ["01", "Reach", "Page views, privacy-respecting unique visitors, referrers, and session duration."],
  ["02", "Experience", "Bounce rate, country-level geography, browser, and device breakdown."],
  ["03", "Reliability", "Request volume, success and error rates, plus p50 and p95 API latency."],
  ["04", "Stewardship", "Global comparison for designated operators, with tenant boundaries kept intact."],
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
        </nav>
        <a className="headerLink" href="#brief">Project brief <span>↗</span></a>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="heroCopy">
            <Eyebrow>Proposed shared infrastructure for Stellar projects</Eyebrow>
            <h1>Make ecosystem use<br /><em>visible.</em> Keep people private.</h1>
            <p className="lede">
              Calistar is a proposed open-source service for privacy-first web and API analytics across projects building on Stellar.
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
            <h2>Useful adoption data<br />without extra burden.</h2>
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
              <h3>Web analytics</h3>
              <p>Version-pinned frontend instrumentation for page views, visitors, referrers, session quality, country-level geography, and device context.</p>
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
              <p>Dual-exported OpenTelemetry metrics become useful request volume, status distribution, and latency percentiles. Traces, spans, and deep logs stay out.</p>
            </article>

            <article className="approachCard scfCard">
              <div className="cardNumber">03</div>
              <div className="compareBars" aria-hidden="true"><span /><span /><span /><span /></div>
              <h3>Shared ecosystem view</h3>
              <p>Projects see their own data. Designated SCF operators compare standardized metrics across enrolled Stellar projects.</p>
            </article>
          </div>
        </section>

        <section className="architectureWrap" id="architecture">
          <div className="container section architecture">
            <div className="sectionHeading narrow">
              <Eyebrow>Designed for handover</Eyebrow>
              <h2>Infrastructure<br />community can run.</h2>
              <p className="sectionCopy">Calistar is proposed as one open-source monorepo: application code, infrastructure-as-code, documentation, runbooks, tests, and operational artifacts.</p>
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

        <section className="container privacyPanel" id="brief">
          <div>
            <Eyebrow>Privacy is architecture</Eyebrow>
            <h2>Measure services.<br />Minimize personal data.</h2>
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
        <p>Proposed open-source infrastructure · 2026</p>
      </footer>
    </>
  );
}
