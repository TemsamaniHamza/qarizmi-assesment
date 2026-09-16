# Atlas Fresh Assessment Rules

This repository implements the Qarizmi Atlas Fresh technical assessment within a
10–12 hour active-work timebox, including reading, planning, testing and delivery.

## Source of truth

- Read `docs/Qarizmi_Atlas Fresh_Weekend_Technical_Assessment.pdf`.
- Read `docs/assessment-readme.md`.
- Treat `data/Atlas_Fresh_Production_Commercial_Data.xlsx` as authoritative input.
- Do not modify the source workbook.
- The PDF defines business policy; the workbook provides input values. These rules
  additionally require Next.js and TypeScript. Derived planning documents must not
  override the assessment or workbook.
- Use `docs/requirements-review.md` for the detailed validation matrix and verified
  baseline, and `docs/execution-plan-10-12-hours.md` for scope and checkpoints.
  `docs/execution-prompts-and-manual-checks.md` contains the block prompts and owner checks.
- Inspect the current repository before changing it; checklist items are not proof
  that a feature exists. Reuse sources already read instead of rereading everything
  at every block unless a source changed or a requirement needs checking.
- Never hardcode baseline results, entity counts, demand, prices, ratio or capacity
  in application logic. Fixed expected values are appropriate in regression tests.

## Architecture

- Use Next.js and TypeScript.
- Load and validate the workbook server-side.
- Keep workbook parsing, domain validation, deterministic calculation, API handling
  and UI rendering as distinct responsibilities. Prefer small modules over frameworks.
- Keep source workbook data separate from computed results; do not mutate inputs.
- Keep validation and the planning engine testable without React, filesystem access,
  HTTP or a model provider. The workbook loader owns filesystem/XLSX access.
- Server routes invoke the shared pipeline. The UI formats and presents returned
  results; it must not implement a second planner or competing KPI calculations.
- Reload/replan must use current validated workbook data, not a build-time result
  or a stale baseline. Do not trust browser-supplied results as assistant evidence.
- No database, authentication, persistence layer, generic optimizer or unnecessary
  infrastructure. A preloaded workbook action is sufficient; upload UI is not required.

## Validation

- Reject missing/duplicate IDs, invalid modes/segments, missing or ambiguous segment
  reference prices, missing/nonnumeric required values and non-finite numbers.
- Expected A/B/C/D mix values are fractions in [0, 1] summing to 1 per farm.
- Actual segment tonnes, client demand and station capacity are non-negative
  multiples of 5 t. Expected daily capacity is non-negative with at most one decimal.
- Zero quantities are valid. Expected segment tonnes and variances can be fractional.
  Actual production exceeding forecast or total supply exceeding station capacity
  is not a validation error.
- Report sheet, entity ID when available, field/cell and the violated rule. Never
  silently drop malformed rows, normalize mixes, round quantities or default blanks to zero.
- Document edge conventions the brief leaves unspecified, including zero-demand
  status, zero-denominator rates and price/ratio bounds. Distinguish assumptions from
  explicit assessment rules. Use test fixtures/copies for invalid-input experiments.

## Planning

- Follow the allocation policy from the assessment exactly.
- Use actual production as supply; expected production is for comparison only.
- Process clients by export price descending, then client_id ascending.
- EXACT accepts only the requested segment. MINIMUM accepts that segment or better;
  A is best, then B, C, D. Consume the smallest quality upgrade first, then farm_id ascending.
- Allocate in 5-tonne increments.
- Respect client demand, farm-segment supply, and station capacity.
- Determine shortage reasons at the end of each client's turn: when still short,
  use STATION_CAPACITY_REACHED if capacity is exhausted, otherwise
  INSUFFICIENT_COMPATIBLE_SEGMENT. Later exhaustion must not rewrite earlier reasons.
- Export revenue uses the served client's price. All residual actual supply goes local,
  outside export station capacity. Local value uses residual tonnes × local ratio ×
  that fruit's segment reference price. Reference prices never affect export priority.
- Return traceable allocations, quality upgrades, client statuses/reasons,
  farm/segment balances, expected/actual comparisons and KPIs in deterministic order.
- Enforce and test: export ≤ capacity; client export ≤ demand; farm/segment export ≤
  actual; every allocation compatible; export + local = actual globally and per farm/segment.

## Workspace

- Support Load → Compare → Plan → Decide → Explain in one coherent workspace.
- Connect farm/segment gaps to client risk and allocation detail. Make local residual
  tonnes and value prominent. Keep execution approval with Production and Commercial.
- Provide loading, empty, validation-error and server-error states plus retry/reset.
- Support keyboard use and real work at 1024 px and 1440 px. Aim for a one-minute
  overview and a three-minute allocation/shortage trace without narration.

## AI

- These restrictions apply to the product's runtime assistant. Coding assistance
  may author, review and test the deterministic implementation.
- Runtime LLMs must never choose allocations, calculate quantities, enforce constraints
  or calculate KPIs. The assistant explains server-computed facts only.
- Implement one real hosted/local model path when configured. Without a model/key,
  show an honest no-key state and a clearly labelled deterministic summary.
- Send minimal structured evidence. Validate output: every number must match its
  supporting server fact, and every cited farm/client ID or segment must resolve.
  An existing ID alone does not make an unsupported claim valid.
- Handle unsupported questions, timeout, provider failure and invalid output honestly.
  Do not invent causes or uncomputed scenario results.
- The assistant cannot change the plan, confirm execution, contact farms/clients or
  write external data. Keep provider credentials server-side and out of Git.

## Development

- Prefer a small, complete implementation over unnecessary features.
- Implement only the requested time block and necessary prerequisites; finish that
  scope before starting a later block. Preserve unrelated user changes.
- Keep the deterministic core working before UI polish. Protect the scheduled time
  for tests, README, clean-start verification, the walkthrough and submission.
- Add meaningful tests for ordering/ties, EXACT/MINIMUM and upgrades, all limits,
  shortage reasons, local valuation, validation, immutability and changed valid inputs.
  The baseline alone does not test quality upgrades. Include grounded-answer and
  unsupported/provider-failure checks for the assistant without paid test calls.
- For implementation changes, run tests, lint and build before reporting completion;
  report failures or checks not run accurately. Do not add fake tests to mask missing coverage.
  For documentation-only work, check content, links and diff; installing dependencies
  or building the application solely for prose edits is unnecessary.
- At each block's handoff, briefly explain the changed data flow and module boundaries,
  list validation performed and remaining gaps, give one owner-review question, and
  suggest a meaningful commit message. Do not turn the explanation into a new planning phase.
- Optional deployment comes only after the mandatory workflow and delivery artifacts
  are ready. Stop at the timebox and document intentional omissions honestly.
