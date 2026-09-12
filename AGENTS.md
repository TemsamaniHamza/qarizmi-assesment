# Atlas Fresh Assessment Rules

This repository implements the Qarizmi Atlas Fresh technical assessment.

## Source of truth

- Read the assessment PDF in `docs/`.
- Read `docs/assessment-readme.md`.
- Treat `data/Atlas_Fresh_Production_Commercial_Data.xlsx` as authoritative input.
- Do not modify the source workbook.
- Do not hardcode baseline values.

## Architecture

- Use Next.js and TypeScript.
- Load and validate the workbook server-side.
- Keep source workbook data separate from computed planning results.
- Keep the planning engine deterministic and independent from the UI.
- Do not add unnecessary infrastructure such as a database.

## Planning

- Follow the allocation policy from the assessment exactly.
- Use actual production as supply; expected production is for comparison only.
- Respect EXACT and MINIMUM compatibility.
- Allocate in 5-tonne increments.
- Respect client demand, farm-segment supply, and station capacity.
- Residual supply goes to the local market.
- Never silently repair invalid input.

## AI

- LLMs must never choose allocations, calculate quantities, enforce constraints, or calculate KPIs.
- AI is read-only and may only explain deterministic planning results.
- AI answers must be grounded in computed results and use valid evidence IDs.

## Development

- Prefer a small, complete implementation over unnecessary features.
- Add meaningful automated tests for planning and validation.
- Run tests, lint, and build before considering a task complete.
- Do not implement optional features before the mandatory workflow works.