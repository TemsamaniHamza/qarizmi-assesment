import type { ReactNode } from "react";
import { useState } from "react";
import { TraceDetails } from "./trace-details";
import { number, signed, money, percent, tonnes, rate, statuses, reasons } from "./display";
import type { Segment } from "../../lib/atlas/types";
import type { WorkspaceData } from "../../lib/atlas/workflow-types";

const segments: readonly Segment[] = ["A", "B", "C", "D"];

function Metric({ label, children, prominent = false }: { label: string; children: ReactNode; prominent?: boolean }) {
  return <div className={`metric${prominent ? " metric-prominent" : ""}`}><dt>{label}</dt><dd>{children}</dd></div>;
}

function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function WorkspaceResults({ data }: { data: WorkspaceData }) {
  const { source, production, plan } = data;
  const [selectedClientId, setSelectedClientId] = useState("");
  const farmSources = new Map(source.farms.map(farm => [farm.farmId, farm]));
  const clientSources = new Map(source.clients.map(client => [client.clientId, client]));
  // Joins and presentation only; every business number comes from the server.
  const commercialRows = plan
    ? plan.clients.map(result => ({ source: clientSources.get(result.clientId)!, result }))
    : source.clients.map(client => ({ source: client, result: null }));
  const risk = plan?.clients.filter(client => client.status !== "COMPLETE");
  return <div className="workspace-results">
    <section aria-labelledby="overview-title">
      <div className="section-heading">
        <div><p className="eyebrow">Daily overview</p><h2 id="overview-title">{plan ? "Plan ready for review" : "Workbook validated"}</h2></div>
        <p className="health">Data health: Validated</p>
      </div>
      <p className="section-note">{plan ? "Execution approval remains with Production and Commercial." : "Production comparisons are ready. Generate Plan to calculate service, station use and value."}</p>
      <dl className="metrics">
        <Metric label="Expected production">{tonnes(production.expectedTotalT)}</Metric>
        <Metric label="Actual production">{tonnes(production.actualTotalT)}</Metric>
        <Metric label="Production variance">{signed.format(production.varianceTotalT)} t</Metric>
        <Metric label="Station capacity">{tonnes(source.station.exportConditioningCapacityT)}</Metric>
        <Metric label="Export volume">{plan ? tonnes(plan.kpis.exportedT) : "Not planned"}</Metric>
        <Metric label="Remaining station capacity">{plan ? tonnes(plan.kpis.remainingStationCapacityT) : "Not planned"}</Metric>
        <Metric label="Station utilization">{plan ? rate(plan.kpis.stationUtilization) : "Not planned"}</Metric>
        <Metric label="Export rate · share of actual">{plan ? rate(plan.kpis.exportRate) : "Not planned"}</Metric>
        <Metric label="Local residual" prominent>{plan ? tonnes(plan.kpis.localT) : "Not planned"}</Metric>
        <Metric label="Local value" prominent>{plan ? money.format(plan.kpis.localValueEur) : "Not planned"}</Metric>
        <Metric label="Export revenue">{plan ? money.format(plan.kpis.exportRevenueEur) : "Not planned"}</Metric>
        <Metric label="Total value · export + local">{plan ? money.format(plan.kpis.totalValueEur) : "Not planned"}</Metric>
      </dl>
      <div className="risk-summary">
        <strong>At-risk clients: {plan ? number.format(plan.kpis.atRiskClients) : "Not planned"}</strong>
        {risk && <p>{risk.length ? risk.map(client => <a key={client.clientId} className="trace-link" href="#trace" onClick={() => setSelectedClientId(client.clientId)}>{client.clientId} ({statuses[client.status]})</a>) : "All client demand is fulfilled."}</p>}
        <p className="section-note">Local residual is actual fruit not exported. Production variance is actual minus forecast; it is not unmet client demand. Undefined rates are shown as N/A.</p>
      </div>
    </section>

    {data.evidence && <TraceDetails evidence={data.evidence} selectedClientId={selectedClientId} onSelect={setSelectedClientId} />}

    <section id="production" tabIndex={-1} aria-labelledby="production-title">
      <h2 id="production-title">Production</h2>
      <p className="section-note">Expected mix is a forecast. Actual receipts supply the plan. Negative variance means below forecast.</p>
      <TableFrame label="Aggregate production comparison"><table>
        <caption>Production by segment · tonnes (t)</caption>
        <thead><tr><th scope="col">Segment</th><th scope="col">Expected (t)</th><th scope="col">Actual (t)</th><th scope="col">Variance (t)</th></tr></thead>
        <tbody>{segments.map(segment => <tr key={segment}><th scope="row">{segment}</th><td>{number.format(production.expectedT[segment])}</td><td>{number.format(production.actualT[segment])}</td><td>{signed.format(production.varianceT[segment])}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Total</th><td>{number.format(production.expectedTotalT)}</td><td>{number.format(production.actualTotalT)}</td><td>{signed.format(production.varianceTotalT)}</td></tr></tfoot>
      </table></TableFrame>
      <TableFrame label="Farm production comparisons"><table>
        <caption>Every farm · expected daily capacity, mix and production</caption>
        <thead><tr><th scope="col">Farm / expected capacity</th><th scope="col">Segment</th><th scope="col">Expected mix</th><th scope="col">Expected (t)</th><th scope="col">Actual (t)</th><th scope="col">Variance (t)</th></tr></thead>
        {data.farms.map(farm => {
          const input = farmSources.get(farm.farmId)!;
          return <tbody key={farm.farmId}>
            <tr className="farm-total"><th scope="rowgroup" rowSpan={5}>{farm.farmId}<span className="cell-detail">{input.farmName}</span><span className="cell-detail">Capacity: {tonnes(input.expectedDailyCapacityT)}</span></th><th scope="row">Total</th><td>—</td><td>{number.format(farm.expectedTotalT)}</td><td>{number.format(farm.actualTotalT)}</td><td>{signed.format(farm.varianceTotalT)}</td></tr>
            {segments.map(segment => <tr key={segment}><th scope="row">{segment}</th><td>{percent.format(input.expectedMix[segment])}</td><td>{number.format(farm.expectedT[segment])}</td><td>{number.format(farm.actualT[segment])}</td><td>{signed.format(farm.varianceT[segment])}</td></tr>)}
          </tbody>;
        })}
      </table></TableFrame>
    </section>

    <section id="commercial" tabIndex={-1} aria-labelledby="commercial-title">
      <h2 id="commercial-title">Commercial</h2>
      <p className="section-note">{plan ? "Clients appear in allocation priority order: export price descending, then client ID. Reasons describe each client's turn." : "Source orders only. Service and revenue remain uncalculated until you generate a plan."}</p>
      <p className="section-note">For wide tables, focus the table area and use the left and right arrow keys to scroll.</p>
      <TableFrame label="Client orders and service outcomes"><table className="commercial-table">
        <caption>Every client · demand, service and export revenue</caption>
        <thead><tr>{["Client", "Rule / segment", "Price (EUR/t)", "Demand (t)", "Allocated (t)", "Unmet (t)", "Revenue (EUR)", "Status", "Shortage reason"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{commercialRows.map(({ source: client, result }) => <tr key={client.clientId}>
          <th scope="row">{result ? <a className="trace-link" href="#trace" onClick={() => setSelectedClientId(client.clientId)}>{client.clientId}</a> : client.clientId}<span className="cell-detail">{client.clientName}</span></th>
          <td>{client.acceptanceMode}<span className="cell-detail">Segment {client.requestedSegment}</span></td>
          <td>{money.format(client.exportPricePerTEur)}</td><td>{number.format(client.demandT)}</td>
          <td>{result ? number.format(result.allocatedT) : "—"}</td><td>{result ? number.format(result.remainingT) : "—"}</td>
          <td>{result ? money.format(result.exportRevenueEur) : "—"}</td>
          <td>{result ? <span className={`client-status status-${result.status.toLowerCase()}`}>{statuses[result.status]}</span> : "Not planned"}</td>
          <td>{result ? result.shortageReason ? reasons[result.shortageReason] : "None" : "—"}</td>
        </tr>)}</tbody>
      </table></TableFrame>
    </section>
  </div>;
}
