This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Planning assistant (5:45–7:00 block)

Generate a plan, then open **Explain / Planning assistant**. The three suggested
questions cover at-risk clients, the largest farm/segment forecast deficits,
and local residual tonnes/value. You can also ask `Why is C02 at risk?` using any
client ID in the current workbook. Other questions are explicitly unsupported;
this is intentionally not a general chat or a scenario simulator.

For Gemini, put `GEMINI_API_KEY` in `.env.local` (or `.env`) and restart Next.js.
Use [.env.example](.env.example) as the secret-free template; do not overwrite an
existing local key. The fixed model is **gemini-2.5-flash-lite**, using the standard
Gemini Developer API. No model SDK or additional dependency is required.
Google lists a [free tier for this model](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite),
but your project must actually use the free tier to avoid charges. A model name
cannot enforce project billing. The app does not enable billing, switch models,
or retry provider requests automatically. Google controls availability and quotas.

Without a key, the panel shows an honest no-key state. Asking a supported question
returns a **Deterministic summary · not an AI answer**. A quota error, provider
failure, 12-second timeout, or invalid response uses the same labelled fallback.
The configuration check makes no model call; calls happen only when you ask.

Data flow: `/api/explain` accepts only a question and source revision, reruns the
same `runWorkflow("plan")` pipeline as Generate Plan, and rejects a revision
mismatch. Browser-supplied calculations/evidence are not accepted. `assistant.ts`
formats a small question-specific packet from the computed plan and trace evidence.
No planning arithmetic or KPI calculation occurs in the model or panel.

Grounding is deliberately strict: Gemini arranges server-authored sentences;
it cannot freely paraphrase or add claims. Output must contain every supplied
fact exactly once, with its exact supporting fact ID and unchanged text. Unknown,
duplicate, omitted, swapped, or altered claims are rejected, including a false
claim citing a real ID. Citations are reconstructed from trusted server records.
The UI discloses this limited model role. Farm gaps rank the five largest negative
variances; they do not attribute a client's shortage to a particular farm.

Credentials stay in server request headers, never browser responses. Only the
question-specific facts are sent to Google, not the workbook or complete plan.
The assistant has no tools to change allocations, approve execution, contact
people, or write external data. Production and Commercial retain approval.

`npm test` uses mocked provider responses only (including grounding, unsupported
questions, timeout, 429/500, malformed responses, recovery, and stale revisions).
It does not make paid calls or prove a live provider connection. Live verification
status is disclosed separately in the implementation handoff.
