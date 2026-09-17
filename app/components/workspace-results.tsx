import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { TraceDetails } from "./trace-details";
import { number, money, percent, tonnes, rate, statuses, forecastDifference, shortageText } from "./display";
import type { Segment } from "../../lib/atlas/types";
import type { WorkspaceData } from "../../lib/atlas/workflow-types";

const segments: readonly Segment[] = ["A", "B", "C", "D"];

function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function WorkspaceResults({ data }: { data: WorkspaceData }) {
  const { source, production, plan, clientSummary } = data;
  const [selectedClientId, setSelectedClientId] = useState("");
  const traceDetails = useRef<HTMLDetailsElement>(null);
  function inspectClient(clientId: string) {
    setSelectedClientId(clientId);
    if (traceDetails.current) traceDetails.current.open = true;
  }
  const farmSources = new Map(source.farms.map(farm => [farm.farmId, farm]));
  const clientSources = new Map(source.clients.map(client => [client.clientId, client]));
  // Joins and presentation only; every business number comes from the server.
  const commercialRows = plan
    ? plan.clients.map(result => ({ source: clientSources.get(result.clientId)!, result }))
    : source.clients.map(client => ({ source: client, result: null }));
  const risk = plan?.clients.filter(client => client.status !== "COMPLETE");
  return <div className="workspace-results">
    <section id="overview" tabIndex={-1} aria-labelledby="overview-title">
      <div className="section-heading">
        <h2 id="overview-title" tabIndex={-1}>Today’s operational situation</h2>
      </div>
      <div className="situation-summary">
        <section aria-labelledby="production-summary-title">
          <h3 id="production-summary-title">Production</h3>
          <p className={`situation-verdict ${production.varianceTotalT < 0 ? "negative" : ""}`}>{forecastDifference(production.varianceTotalT)}</p>
          <dl className="summary-pairs"><div><dt>Expected</dt><dd>{tonnes(production.expectedTotalT)}</dd></div><div><dt>Actually received</dt><dd>{tonnes(production.actualTotalT)}</dd></div></dl>
        </section>
        <section aria-labelledby="station-summary-title">
          <h3 id="station-summary-title">Station & export plan</h3>
          <p className="situation-verdict">{!plan ? "Not planned yet" : source.station.exportConditioningCapacityT === 0 ? "No export capacity available" : plan.kpis.remainingStationCapacityT === 0 ? "Station at full export capacity" : `${tonnes(plan.kpis.remainingStationCapacityT)} export capacity available`}</p>
          <dl className="summary-pairs"><div><dt>Station capacity</dt><dd>{tonnes(source.station.exportConditioningCapacityT)}</dd></div><div><dt>Exported</dt><dd>{plan ? tonnes(plan.kpis.exportedT) : "Not planned"}</dd></div><div><dt>For local market</dt><dd>{plan ? tonnes(plan.kpis.localT) : "Not planned"}</dd></div><div><dt>Utilization</dt><dd>{plan ? rate(plan.kpis.stationUtilization) : "Not planned"}</dd></div></dl>
        </section>
        <section aria-labelledby="clients-summary-title" className={risk?.length ? "client-impact has-risk" : "client-impact"}>
          <h3 id="clients-summary-title">Client impact</h3>
          <p className={`situation-verdict ${risk?.length ? "negative" : ""}`}>{plan ? `${number.format(plan.kpis.atRiskClients)} clients at risk` : "Generate Plan to check service"}</p>
          <dl className="summary-pairs"><div><dt>Complete</dt><dd>{clientSummary ? `${number.format(clientSummary.completedClients)} clients` : "Not planned"}</dd></div><div><dt>Total unmet demand</dt><dd>{clientSummary ? tonnes(clientSummary.unmetDemandT) : "Not planned"}</dd></div></dl>
          <p className="summary-note">Unmet demand is unfilled client orders, not the production forecast gap.</p>
        </section>
      </div>
      <section id="attention" aria-labelledby="attention-title" className="attention-section">
        <div className="section-heading"><h3 id="attention-title">Needs attention</h3><p className="section-note">{plan ? "Select a client to inspect the allocation evidence." : "Generate Plan to identify affected clients."}</p></div>
        {risk && (risk.length ? <div className="attention-list">{risk.map(client => {
          const order = clientSources.get(client.clientId)!;
          return <a key={client.clientId} className="attention-row" href="#trace" onClick={() => inspectClient(client.clientId)}>
            <span className="attention-client"><strong>{client.clientId}</strong><span>{order.clientName}</span></span>
            <span className="attention-service"><strong>{tonnes(client.remainingT)} unmet</strong><span>{tonnes(client.allocatedT)} allocated of {tonnes(order.demandT)} requested</span></span>
            <span className="attention-reason">{shortageText(client.shortageReason, order.requestedSegment, order.acceptanceMode)}</span>
            <span className="attention-link">Inspect allocation <span aria-hidden="true">→</span></span>
          </a>;
        })}</div> : <p className="all-served">No client shortages. All demand is fulfilled.</p>)}
      </section>
    </section>

    <section id="production" tabIndex={-1} aria-labelledby="production-title" className="panel">
      <div className="section-heading"><div><p className="eyebrow">01 / Compare</p><h2 id="production-title">Production</h2></div><span className="section-tag">Expected vs actual</span></div>
      <p className="section-note">Expected mix is a forecast. Actual receipts supply the plan. A forecast deficit does not necessarily mean unmet client demand.</p>
      <TableFrame label="Aggregate production comparison"><table className="segment-table">
        <caption>Production by segment · tonnes (t)</caption>
        <thead><tr><th scope="col">Quality segment</th><th scope="col">Expected (t)</th><th scope="col">Actual (t)</th><th scope="col">Difference vs forecast</th></tr></thead>
        <tbody>{segments.map(segment => <tr key={segment}><th scope="row">Segment {segment}</th><td>{number.format(production.expectedT[segment])}</td><td className="cell-emphasis">{number.format(production.actualT[segment])}</td><td className={production.varianceT[segment] < 0 ? "negative" : "positive"}>{forecastDifference(production.varianceT[segment])}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Total</th><td>{number.format(production.expectedTotalT)}</td><td>{number.format(production.actualTotalT)}</td><td>{forecastDifference(production.varianceTotalT)}</td></tr></tfoot>
      </table></TableFrame>
      <details className="farm-details">
        <summary>Farm-by-farm production <span>Expand capacity, mix and segment comparisons</span></summary>
        <TableFrame label="Farm production comparisons"><table>
          <caption>Every farm · expected daily capacity, mix and production</caption>
          <thead><tr><th scope="col">Farm / expected capacity</th><th scope="col">Segment</th><th scope="col">Expected mix</th><th scope="col">Expected (t)</th><th scope="col">Actual (t)</th><th scope="col">Difference vs forecast</th></tr></thead>
          {data.farms.map(farm => {
            const input = farmSources.get(farm.farmId)!;
            return <tbody key={farm.farmId}>
              <tr className="farm-total"><th scope="rowgroup" rowSpan={5}>{farm.farmId}<span className="cell-detail">{input.farmName}</span><span className="cell-detail">Capacity: {tonnes(input.expectedDailyCapacityT)}</span></th><th scope="row">Total</th><td>—</td><td>{number.format(farm.expectedTotalT)}</td><td>{number.format(farm.actualTotalT)}</td><td>{forecastDifference(farm.varianceTotalT)}</td></tr>
              {segments.map(segment => <tr key={segment}><th scope="row">{segment}</th><td>{percent.format(input.expectedMix[segment])}</td><td>{number.format(farm.expectedT[segment])}</td><td>{number.format(farm.actualT[segment])}</td><td className={farm.varianceT[segment] < 0 ? "negative" : "positive"}>{forecastDifference(farm.varianceT[segment])}</td></tr>)}
            </tbody>;
          })}
        </table></TableFrame>
      </details>
    </section>

    <section id="commercial" tabIndex={-1} aria-labelledby="commercial-title" className="panel">
      <div className="section-heading"><div><p className="eyebrow">02 / Decide</p><h2 id="commercial-title">Commercial & client service</h2></div><span className="section-tag">{plan ? "Allocation priority order" : "Source orders"}</span></div>
      <p className="section-note">{plan ? "Higher export prices take priority, then client ID. Shortage reasons describe each client’s turn." : "Generate Plan to see allocated tonnes, remaining demand, revenue and service status."}</p>
      <TableFrame label="Client orders and service outcomes"><table className="commercial-table">
        <caption>Every client · demand, service and export revenue</caption>
        <thead><tr>{["Client", "Accepted quality", "Price (EUR/t)", "Demand (t)", "Allocated (t)", "Unmet (t)", "Revenue (EUR)", "Status", "Shortage reason"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{commercialRows.map(({ source: client, result }) => <tr key={client.clientId} className={result && result.status !== "COMPLETE" ? "at-risk-row" : undefined}>
          <th scope="row">{result ? <a className="trace-link" href="#trace" onClick={() => inspectClient(client.clientId)}>{client.clientId} <span aria-hidden="true">↗</span></a> : client.clientId}<span className="cell-detail">{client.clientName}</span></th>
          <td>Segment {client.requestedSegment}<span className="cell-detail">{client.acceptanceMode === "EXACT" ? "This segment only" : "This segment or better"}</span></td>
          <td>{money.format(client.exportPricePerTEur)}</td><td>{number.format(client.demandT)}</td>
          <td className="cell-emphasis">{result ? number.format(result.allocatedT) : "—"}</td><td className={result && result.remainingT > 0 ? "negative cell-emphasis" : undefined}>{result ? number.format(result.remainingT) : "—"}</td>
          <td>{result ? money.format(result.exportRevenueEur) : "—"}</td>
          <td>{result ? <span className={`client-status status-${result.status.toLowerCase()}`}>{statuses[result.status]}</span> : <span className="section-tag">Not planned</span>}</td>
          <td>{result ? shortageText(result.shortageReason, client.requestedSegment, client.acceptanceMode) : "—"}</td>
        </tr>)}</tbody>
      </table></TableFrame>
      {plan && <details className="secondary-details"><summary>Export rate & commercial value</summary><dl className="value-strip">
        <div><dt>Export rate · share of actual</dt><dd>{rate(plan.kpis.exportRate)}</dd></div>
        <div><dt>Export revenue</dt><dd>{money.format(plan.kpis.exportRevenueEur)}</dd></div>
        <div><dt>Local market value</dt><dd>{money.format(plan.kpis.localValueEur)}</dd></div>
        <div><dt>Total value · export + local</dt><dd>{money.format(plan.kpis.totalValueEur)}</dd></div>
      </dl></details>}
      <p className="table-hint">Wide table: focus the table area and use ← → to scroll. Select a client ID to inspect its trace.</p>
    </section>

    {data.evidence && <details ref={traceDetails} id="allocation-evidence" className="trace-disclosure">
      <summary>Allocation evidence <span>Inspect client service, source farms and local balances</span></summary>
      <TraceDetails evidence={data.evidence} selectedClientId={selectedClientId} onSelect={setSelectedClientId} />
    </details>}
    <p className="workspace-footnote">Fruit for the local market is actual production not exported. Forecast differences and unmet orders are separate measures. Undefined rates are shown as N/A.</p>
  </div>;
}
