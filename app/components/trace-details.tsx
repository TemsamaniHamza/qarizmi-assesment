import type { PlanningEvidence } from "../../lib/atlas/evidence";
import { number, money, statuses, forecastDifference, shortageText } from "./display";

export function TraceDetails({ evidence, selectedClientId, onSelect }: {
  evidence: PlanningEvidence;
  selectedClientId: string;
  onSelect: (clientId: string) => void;
}) {
  const selected = evidence.clients.find(row => row.client.clientId === selectedClientId)
    ?? evidence.clients.find(row => row.outcome.status !== "COMPLETE") ?? evidence.clients[0];
  if (!selected) return <section id="trace"><h2>Client trace</h2><p>No client evidence available.</p></section>;
  const { client, outcome, allocations, farmSegments } = selected;
  const gaps = farmSegments.filter(row => row.varianceT < 0);
  return <section id="trace" aria-labelledby="trace-title" tabIndex={-1} className="panel trace-section">
    <div className="section-heading">
      <div><p className="eyebrow">03 / Investigate</p><h2 id="trace-title">Client allocation evidence</h2></div>
      <div className="client-picker"><label htmlFor="trace-client">Selected client</label>
        <select id="trace-client" value={client.clientId} onChange={event => onSelect(event.target.value)}>
          {evidence.clients.map(row => <option key={row.client.clientId} value={row.client.clientId}>{row.client.clientId} · {row.client.clientName} · {statuses[row.outcome.status]}</option>)}
        </select>
      </div>
    </div>
    <div aria-live="polite" className="trace-summary">
      <div className="section-heading"><h3>{client.clientId} <span className="trace-client-name">{client.clientName}</span></h3><span className={`client-status status-${outcome.status.toLowerCase()}`}>{statuses[outcome.status]}</span></div>
      <p className="section-note">Requested Segment {client.requestedSegment} · {client.acceptanceMode === "EXACT" ? "Accepts this segment only" : "Accepts this segment or better"}</p>
      <dl className="trace-metrics">
        <div><dt>Demand</dt><dd>{number.format(client.demandT)} t</dd></div>
        <div><dt>Allocated</dt><dd>{number.format(outcome.allocatedT)} t</dd></div>
        <div><dt>Unmet demand</dt><dd className={outcome.remainingT > 0 ? "negative" : undefined}>{number.format(outcome.remainingT)} t</dd></div>
        <div><dt>Export revenue</dt><dd>{money.format(outcome.exportRevenueEur)}</dd></div>
      </dl>
      <p className="trace-reason"><strong>Reason at this client’s turn:</strong> {shortageText(outcome.shortageReason, client.requestedSegment, client.acceptanceMode)}.</p>
    </div>
    <div className="table-scroll" role="region" aria-label="Selected client allocations" tabIndex={0}><table>
      <caption>Allocations for {client.clientId} · export price {money.format(client.exportPricePerTEur)}/t</caption>
      <thead><tr>{["Farm ID", "Segment", "Client ID", "Tonnes (t)", "Quality upgrade (levels)", "Revenue (EUR)"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{allocations.length ? allocations.map(row => <tr key={`${row.farmId}/${row.segment}`}><th scope="row">{row.farmId}</th><td>{row.segment}</td><td>{row.clientId}</td><td>{number.format(row.tonnes)}</td><td>{row.qualityUpgrade === 0 ? "0 · requested quality" : `+${row.qualityUpgrade} · ${client.requestedSegment} → ${row.segment}`}</td><td>{money.format(row.exportRevenueEur)}</td></tr>) : <tr><td colSpan={6}>No export allocations for this client.</td></tr>}</tbody>
    </table></div>

    <details className="secondary-details"><summary>Fruit remaining for the local market <span>Final balances across all clients</span></summary>
    <div className="table-scroll" role="region" aria-label="Local residual breakdown" tabIndex={0}><table>
      <caption>Fruit for local market · final plan balances, across every client</caption>
      <thead><tr>{["Farm ID", "Segment", "Actual (t)", "Exported (t)", "Local (t)", "Local value (EUR)", "Supplied selected client"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{evidence.localResiduals.length ? evidence.localResiduals.map(row => <tr key={`${row.farmId}/${row.segment}`}><th scope="row">{row.farmId}</th><td>{row.segment}</td><td>{number.format(row.actualT)}</td><td>{number.format(row.exportedT)}</td><td>{number.format(row.localT)}</td><td>{money.format(row.localValueEur)}</td><td>{allocations.some(allocation => allocation.farmId === row.farmId && allocation.segment === row.segment) ? "Yes" : "No"}</td></tr>) : <tr><td colSpan={7}>No local residuals in this plan.</td></tr>}</tbody>
    </table></div>
    <p className="section-note">Local balances are after all clients, not unused capacity or stock available at the selected client’s turn.</p>

    </details>
    <details className="secondary-details"><summary>Related farm forecast gaps <span>Production context, not proof of cause</span></summary>
    <div className="table-scroll" role="region" aria-label="Relevant farm segment forecast gaps" tabIndex={0}><table>
      <caption>Below-forecast farm segments · requested segment and any qualities actually supplied</caption>
      <thead><tr>{["Farm ID", "Segment", "Expected (t)", "Actual (t)", "Difference vs forecast", "Exported overall (t)", "Local (t)"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{gaps.length ? gaps.map(row => <tr key={`${row.farmId}/${row.segment}`}><th scope="row">{row.farmId}</th><td>{row.segment}</td><td>{number.format(row.expectedT)}</td><td>{number.format(row.actualT)}</td><td>{forecastDifference(row.varianceT)}</td><td>{number.format(row.exportedT)}</td><td>{number.format(row.localT)}</td></tr>) : <tr><td colSpan={7}>No below-forecast farms in these segments.</td></tr>}</tbody>
    </table></div>
    <p className="section-note">Forecast gaps provide production context; they do not prove that any single farm caused this client’s shortage. Service depends on actual supply, priority, compatibility and station capacity. A below-forecast segment can still meet client demand.</p>
    </details>
  </section>;
}
