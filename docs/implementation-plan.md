# Atlas Fresh Implementation Plan

## Goal

Build one browser-based Production–Commercial planning workspace that:

1. loads and validates the provided workbook server-side
2. compares expected production with actual production
3. generates a deterministic export allocation plan
4. shows client service, station capacity, revenue, and local residual
5. explains the computed plan through a grounded read-only AI assistant

## Milestone 1 — Core data pipeline

- [ ] Define TypeScript domain types
- [ ] Parse Farms sheet
- [ ] Parse Clients sheet
- [ ] Parse Station sheet
- [ ] Validate workbook
- [ ] Return actionable validation errors

## Milestone 2 — Deterministic planner

- [ ] Use actual production as supply
- [ ] Sort clients by export price descending
- [ ] Tie-break clients by client_id
- [ ] Implement EXACT compatibility
- [ ] Implement MINIMUM compatibility
- [ ] Prefer smallest quality upgrade
- [ ] Tie-break supply by farm_id
- [ ] Allocate in 5-tonne steps
- [ ] Respect client demand
- [ ] Respect farm-segment supply
- [ ] Respect station capacity
- [ ] Calculate local residual
- [ ] Calculate client statuses/reasons
- [ ] Calculate KPIs

## Milestone 3 — Automated tests

- [ ] Client ordering
- [ ] EXACT compatibility
- [ ] MINIMUM compatibility
- [ ] Station capacity invariant
- [ ] Export + local = actual
- [ ] Invalid workbook rejected
- [ ] Baseline values match

## Milestone 4 — Workspace UI

- [ ] Overview / KPI cards
- [ ] Production view
- [ ] Commercial view
- [ ] Allocation trace
- [ ] Local residual visible
- [ ] Loading state
- [ ] Validation error state
- [ ] Server error state
- [ ] Retry
- [ ] Responsive at 1024px and 1440px

## Milestone 5 — AI assistant

- [ ] Read-only explanation
- [ ] Uses computed plan only
- [ ] Evidence IDs
- [ ] Three required questions
- [ ] No-key fallback
- [ ] Invalid-output/provider-error handling

## Milestone 6 — Delivery

- [ ] npm test
- [ ] npm run lint
- [ ] npm run build
- [ ] README
- [ ] AI usage disclosure
- [ ] Approximate time spent
- [ ] Limitations
- [ ] Next 3 production steps
- [ ] 3–5 minute walkthrough video