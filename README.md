# Atlas Fresh — Daily Export Planner

A Production–Commercial workspace for the fictional Qarizmi Atlas Fresh assessment. Load the supplied apple-production workbook, compare forecasts with receipts, generate the prescribed export allocation, inspect client shortages and local sales, and ask for an explanation backed by the computed plan.

**Production and Commercial retain approval of execution.** The application does not approve plans, contact farms or clients, or write to external systems. Planning and deterministic summaries work without an API key or paid service.

## Prerequisites

- Git, Node.js and npm. Recorded local checks used **Node.js 20.19.2 and npm 9.2.0 on Linux**. The installed Next.js version requires Node.js **20.9.0 or newer**.
- Network access for `npm ci` and for Google Fonts during a fresh build: [layout.tsx](app/layout.tsx) uses `next/font/google` for Geist. A fully offline first build is not supported.
- A browser supporting the HTML Popover API and `AbortSignal.timeout` / `AbortSignal.any`. The floating assistant uses a native popover. Browser compatibility and the target 1024/1440 px layouts still need manual verification.
- The bundled [source workbook](data/Atlas_Fresh_Production_Commercial_Data.xlsx), included in Git. No database, account or additional data download is required.

## Clean-start commands

Run these commands in order. No environment file is required for the default no-key experience. The clone URL comes from this repository's configured remote; evaluator access still needs owner confirmation.

```bash
git clone https://github.com/TemsamaniHamza/qarizmi-assesment.git
cd qarizmi-assesment
npm ci
npm test
npm run lint
npm run build
npm run start
```

Open **http://localhost:3000**. Keep the terminal running; use Ctrl+C to stop it. Run commands from the repository root because the server resolves the workbook path from its working directory.

These are the commands to verify in the scheduled clean-checkout block. **Acceptance I remains pending**; successful checks in an existing working directory do not prove that a fresh clone works.

| Command | Purpose |
|---|---|
| `npm ci` | Install exact dependencies from `package-lock.json`. |
| `npm test` | Run Vitest once; model/network responses are mocked in assistant tests. |
| `npm run lint` | Run ESLint. |
| `npm run build` | Create a production build with `next build --webpack`, including TypeScript checks. |
| `npm run start` | Serve the existing production build on port 3000. Rebuild after changing code. |
| `npm run dev` | Start the development server when editing the application. |

The build script uses webpack because Turbopack failed to create a CSS-processing subprocess/port in the assessment environment. The final recorded webpack build passed with sandbox execution approval; earlier sandbox runs also encountered a TypeScript subprocess configuration error. This does not establish behavior on a clean machine.

## Use the workspace

1. **Load:** select **Load workbook**. The server reads and validates the current file. Comparisons appear; export results remain “Not planned”.
2. **Compare:** open **Production vs forecast**, then **Farm-by-farm production** for capacity, mix and segment differences.
3. **Plan:** select **Generate Plan**. The server reloads the workbook and computes the result; it does not reuse a build-time baseline.
4. **Decide:** review the overview and **Needs attention**. Select a client to inspect its allocations, **Related farm forecast gaps** and **Fruit remaining for the local market**. The local breakdown is the final balance across all clients, not stock reserved for the selected client.
5. **Explain:** open the **Ask about this plan** bubble at the bottom-right. Choose a suggested question, or enter `Why is C02 at risk?`. Expand **View supporting records** to see IDs. Close the popover with ×, Escape or an outside click.

Load/Plan failures replace the previous results. Use the displayed Retry action or Reset. Invalid workbook cells produce HTTP 422 with sheet, entity ID when available, field/cell and the violated rule. File/server failures produce HTTP 500. Calculations producing NaN or infinity also return a controlled 500 with no partial result, rather than a false success containing null values.

## Input and baseline

The authoritative input is `data/Atlas_Fresh_Production_Commercial_Data.xlsx`. The loader reads `Farms`, `Clients` and `Station`; the `Read Me` sheet contains explanatory material and public checks. Operational headers are on row 4; Station's reference-price headers are on row 16. This parser targets the supplied layout, not arbitrary spreadsheets.

Keep the source workbook unchanged. Invalid-input and changed-input tests use fixtures or in-memory copies. The code does not hardcode the baseline totals, entity counts, capacity, prices or local ratio.

| Baseline metric | Computed result |
|---|---:|
| Expected / actual production | 600 / 560 t |
| Actual A / B / C / D | 90 / 160 / 180 / 130 t |
| Station capacity / export | 500 / 500 t |
| Station utilization / export rate | 100% / 89.3% |
| Local residual | 60 t |
| Export revenue / local value | EUR 549,500 / EUR 4,500 |
| Total value | EUR 554,000 |
| Complete / partial / unserved clients | 7 / 3 / 0 |

C02 receives 40 of 50 t and C09 receives 30 of 50 t because compatible supply runs out during their turns. C08 receives 20 of 50 t because station capacity runs out. The UI labels a `PARTIAL` client “Unmet demand”.

A useful trace: C08 receives F14/D 5 t and F15/D 15 t. At C08's EUR 700/t, these earn EUR 3,500 and EUR 10,500. F15/D retains 5 t locally, worth `5 × 0.10 × 750 = EUR 375`. All baseline residual is D: F15 5 t, F16 20 t, F19 5 t and F20 30 t, worth EUR 4,500 together.

## Allocation policy

1. Validate source records before calculating. Actual receipts provide supply; forecasts are comparison data only.
2. Process clients by export price descending, then client ID ascending for ties.
3. EXACT accepts only the requested segment. MINIMUM accepts that segment or better: A is best, followed by B, C, D.
4. Consume the smallest quality upgrade first, then farm ID ascending. MINIMUM C consumes C before B before A.
5. Allocate in 5 t units without exceeding client demand, farm/segment supply or station capacity. Consecutive identical steps are grouped into trace rows.
6. Record the shortage reason at the end of each client's turn. If still short, use `STATION_CAPACITY_REACHED` when capacity is exhausted; otherwise use `INSUFFICIENT_COMPATIBLE_SEGMENT`. Later exhaustion does not rewrite an earlier reason.
7. Send every residual actual tonne to local, outside export station capacity. Export revenue uses the served client's price. Local value uses `residual tonnes × local ratio × residual segment reference price`. Reference prices never change export priority.

The planner tests enforce compatibility, quantity limits and conservation globally and per farm/segment: **export + local = actual**. Total value is export revenue plus local value. A forecast deficit is distinct from unmet orders and local residual; it does not prove which farm caused a client's shortage.

## Architecture and calculation ownership

Next.js App Router and TypeScript, with React for presentation, SheetJS (`xlsx`) for workbook reading and Vitest for tests. There is one shared server pipeline:

```text
Browser action → server route → workbook loader → pure validator
  → comparison / deterministic planner → linked evidence → browser presentation

Explanation request → rerun the same plan → check source revision
  → select server facts → optional Gemini call → validate exact facts → display
```

| Module | Responsibility |
|---|---|
| [workbook.ts](lib/atlas/workbook.ts) | Filesystem/XLSX boundary; fresh reads and cell locations. |
| [validate.ts](lib/atlas/validate.ts) | Pure source validation; no React, HTTP, filesystem or model dependency. |
| [compare.ts](lib/atlas/compare.ts) | Expected segment tonnes = capacity × mix; actual totals and actual-minus-expected variances. |
| [plan.ts](lib/atlas/plan.ts) | Allocations, upgrades, client status/reasons, balances, export/local value and main KPIs. Owns its working balances without mutating source data. |
| [finite-values.ts](lib/atlas/finite-values.ts) | Reject non-finite numeric values in complete calculated outputs before they can be serialized. No clamping or arbitrary price ceiling. |
| [client-summary.ts](lib/atlas/client-summary.ts), [evidence.ts](lib/atlas/evidence.ts) | Completed-client/unmet-demand totals and joins between existing source/results. |
| [workflow.ts](lib/atlas/workflow.ts) | Orchestration, source fingerprint and consistent responses. POST `/api/load` compares; POST `/api/plan` also allocates. |
| [explain route](app/api/explain/route.ts), [assistant.ts](lib/atlas/assistant.ts), [gemini.ts](lib/atlas/gemini.ts) | Check the current revision, select question-specific facts, call the configured model and validate its response. |
| [page.tsx](app/page.tsx), `app/components/` | Request state, client selection, formatting and presentation. No second planner or competing business calculations. |

## Validation assumptions and edge conventions

Explicit assessment rules include required/unique IDs, valid quality modes and segments, complete unambiguous segment reference prices, expected mixes in [0,1] summing to one, and non-negative 5 t multiples for actual supply, demand and station capacity. Expected capacity permits at most one decimal. Missing/nonnumeric required cells, Excel errors and non-finite numbers are rejected; blanks are not zero.

Additional implementation conventions, rather than claims about the brief:

- Require at least one farm/client, non-empty names and exactly one station. Skip only entirely empty rows; reject partial/malformed records. Entity counts are otherwise not fixed.
- Prices must be finite and non-negative; local ratio must lie in [0,1]. Step quantities must fit JavaScript's safe-integer range. Calculated overflow is rejected, not repaired. Arithmetic uses JavaScript numbers, not an arbitrary-precision money library.
- ID uniqueness is case-sensitive within each entity table. Source spellings are preserved. Assistant client references prefer exact matches; case-insensitive fallback requires exactly one match, otherwise the reference is unsupported.
- Mix sums allow only a `1e-12` absolute tolerance for binary floating-point addition. Mixes and quantities are not normalized or rounded to become valid.
- Zero quantities are valid. A zero-demand client is COMPLETE. Rates with zero denominators are null in the server result and displayed as N/A. Other numbers are formatted only for display.
- Expected segment tonnes and differences may be fractional. Actual supply above forecast or total supply above station capacity is valid.

## Optional model configuration and boundaries

No model configuration is needed to use the core product. For the implemented hosted path, create `.env.local` from the secret-free [.env.example](.env.example), or edit your existing local file without overwriting its other settings:

```dotenv
GEMINI_API_KEY=your_own_key
```

Restart the server after configuration changes. The fixed model is **gemini-2.5-flash-lite**, called through the Gemini Developer API. Model availability, quotas and billing depend on your provider project; the application does not guarantee free configured calls. It makes one attempt per supported question, with a 12-second provider timeout and no automatic model switching or retries.

Without a key, the UI reports that AI is not connected and answers supported questions with **“Plan summary · not AI-generated”**. Provider failures, timeouts and rejected model output also use a clearly labelled deterministic fallback. **“AI explanation”** means a returned model response passed the application's checks. No live model success is claimed in this README.

Supported topics:

- Which clients are at risk and why?
- Which farm/segment gaps matter most today?
- Why is fruit going local and what is its estimated value?
- `Why is <client ID> at risk?` or `Why is <client ID> short?`

The PDF's quantity-specific local question is also recognized when its quantity matches the current result. Unsupported questions, weather causes, uncomputed scenarios and execution requests are not guessed.

The explanation route accepts only a question and source revision. It reruns the shared pipeline; a changed revision returns 409 and asks the user to generate a new plan. Browser-supplied results are rejected as evidence.

Gemini can arrange **exact server-written sentences**, not freely add or paraphrase claims. Each supplied fact must appear once, unchanged and paired with its own fact ID. Unknown, duplicated, omitted, swapped or altered facts are rejected. References are attached from trusted server records. The model never allocates, calculates KPIs, enforces constraints, approves execution or writes external data. Forecast-gap ranking uses existing server variances and does not establish causes.

Only question-specific fact IDs/text are sent to the provider, not the workbook or full plan. Credentials remain in a server request header; local env files are Git-ignored. GET `/api/explain` checks configuration without invoking the model. Never commit credentials.

## Verification and current limitations

Recorded checks from the implementation session, for the code now committed as `167843a` before this README edit:

| Check | Observed evidence |
|---|---|
| `npm test` | **294 tests passed across 11 files**, after the floating-assistant change. |
| `npm run lint` | **Passed**. |
| `npm run build` | **Passed** with webpack and approved execution, including TypeScript and static page generation. |
| Baseline and changed inputs | Tests cover baseline totals/reasons/trace, ties, all quality combinations, forced upgrades, zero cases, limits, immutability, validation, changed capacity/forecast/prices/ratio and overflow rejection. Capacity 495 t produces export/local 495/65 t and C08 allocation 15 t. |
| Assistant | Mocked tests cover exact/ambiguous client IDs, grounded output, unsupported requests, failure/timeout, injected evidence and stale revisions. These tests make no live provider calls. |
| Production HTTP | Earlier session checks observed Load/Plan baseline and no-key answers for all three required topics, plus rejected execution approval. These preceded the final floating-panel change. |
| UI markup | Render tests verify that overview KPIs are outside closed disclosures and Load does not show uncomputed export values. This is not visual/browser proof. |
| Workbook | Remained unchanged through the recorded tests and audits; invalid experiments used copies. |

**Still pending:** browser keyboard/focus/scroll behavior, 1024/1440 px layout, floating-popover interactions, visible error recovery, the one-minute overview/three-minute trace exercise, and a real configured-provider success. Browser access was unavailable during the recorded audit. Server recovery tests do not substitute for browser checks.

**Acceptance I remains pending** until the scheduled disposable clean-checkout run proves install, tests, lint, build, start and no-key Load → Plan on the candidate revision. This documentation block checks text and references only; it does not repeat those checks or claim clean-start verification.

Intentional omissions: upload UI and arbitrary workbook layouts; scenario simulation, a generic optimizer and manual allocation editing; database/history, authentication and persistent approvals; external farm/client integrations; general-purpose chat, multiple model providers and autonomous actions. Optional deployment has not been performed. The product requires a Node server with access to its workbook; it is not a static-only export.

Local `docs/` and `.notes/` are Git-ignored preparation material. This README links to committed implementation/data and does not require those local notes for startup.

## Next three production steps — proposed, not implemented

1. Verify the target runtime: package the workbook with the Node service, manage server secrets, add operational error monitoring and repeat browser/provider/release checks in that environment.
2. Replace the single snapshot with a controlled daily-data process: source version tracking, validated imports and reconciliation before a plan is reviewed.
3. Design an audited Production–Commercial approval process with appropriate access control and history before introducing any execution integration.

Finish the mandatory acceptance and delivery work first. These are future proposals, not additional assessment scope.

## Four-minute walkthrough outline

| Time | Show and explain |
|---|---|
| 0:00–0:35 | Load the workbook. Show 600 t expected versus 560 t actual and explain that actual receipts supply the plan. |
| 0:35–1:10 | Generate Plan. Show 500 t export, 60 t local, three clients at risk and the commercial values. |
| 1:10–1:45 | Open farm comparisons: F01/A is 31.5 t expected versus 25 t actual. Distinguish forecast gaps from unmet orders. |
| 1:45–2:35 | Inspect C02/C09 segment reasons and C08's capacity reason. Trace C08 to F14/D 5 t and F15/D 15 t; explain the client-price revenue calculation. |
| 2:35–3:05 | Expand local balances. Show F15/D's 5 t × 0.10 × EUR 750 = EUR 375 and total local value EUR 4,500. |
| 3:05–3:40 | Open the floating assistant, ask about C02 and expand supporting records. Show the actual no-key/model state honestly; try an unsupported weather or approval question. |
| 3:40–4:00 | Show Reset and mention verified tests, pending checks and human execution approval. Do not present an unperformed check as complete. |

This is a recording outline, not evidence that the walkthrough has been recorded or shared.

## AI coding assistance and owner-supplied delivery details

OpenAI Codex assisted with planning, implementation, automated tests, defect investigation, UI changes and documentation in this development session. The runtime Gemini assistant is separate and restricted to explaining computed facts. The author must understand and review the submitted code; passing automated checks does not establish unobserved browser behavior. Any additional tools used outside this session should be disclosed by the owner.

| Detail | Status to complete before submission |
|---|---|
| Repository | `https://github.com/TemsamaniHamza/qarizmi-assesment` — owner must confirm evaluator access/visibility and provide any invitation instructions. No app login is implemented. |
| 3–5 minute walkthrough URL | **Pending owner recording/upload and access check.** |
| Approximate total active time | **Pending owner input**, including reading, planning, implementation, testing and delivery. The 10–12 hour brief is a limit, not a measured time claim. |
| Personal/manual verification | **Pending owner record** of browser checks and any live model call; do not infer these from the test count. |
| Optional live URL | Not provided; optional deployment omitted. |
| Other AI coding tools used | Owner to confirm any tools used outside the documented Codex session. |
