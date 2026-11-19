import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Technical notes — Calistar",
  description: "Technical approach for Calistar privacy-first ecosystem analytics.",
};

export default function TechnicalNotes() {
  return (
    <main className="docsPage">
      <header className="docsHeader">
        <a href="/" className="brand">← Calistar</a>
        <span>TECHNICAL NOTES · DRAFT</span>
      </header>

      <article className="docsContent">
        <p className="eyebrow"><span />Architecture overview</p>
        <h1>Privacy-first web and API analytics for Stellar projects.</h1>
        <p className="docsLead">
          Calistar is proposed shared infrastructure for standardized,
          privacy-conscious service metrics across participating Stellar projects.
        </p>

        <section>
          <h2>Collection</h2>
          <ul>
            <li><strong>Web:</strong> self-hosted Umami, embedded through a version-pinned frontend snippet.</li>
            <li><strong>APIs:</strong> OpenTelemetry metrics only: request volume, status classes, and latency percentiles.</li>
            <li><strong>Not collected:</strong> traces, span payloads, deep logs, or unnecessary request bodies.</li>
          </ul>
        </section>

        <section>
          <h2>Data boundaries</h2>
          <ul>
            <li>Projects access their own tenant-scoped data.</li>
            <li>Designated SCF operators access standardized aggregate comparisons.</li>
            <li>Privacy filtering happens before storage. Metrics remain operational and aggregated.</li>
          </ul>
        </section>

        <section>
          <h2>Proposed stack</h2>
          <p>Next.js and TypeScript for dashboards, self-hosted Umami for web analytics, OpenTelemetry for API metrics, and PostgreSQL for normalized aggregates.</p>
        </section>

        <section>
          <h2>Handover</h2>
          <p>Planned open-source repository includes application code, infrastructure-as-code, tests, runbooks, operational documentation, and deployment guidance.</p>
        </section>

        <p className="docsFooter">Implementation details, hosting location, and operating commitments remain subject to approved scope.</p>
      </article>
    </main>
  );
}
