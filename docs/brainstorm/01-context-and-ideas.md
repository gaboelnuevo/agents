# Context and agent ideas

## Where they usually fit

- **Time- or sequence-based data**: metrics, events, series; time windows and thresholds.
- **Product and operations**: software usage, process compliance, service quality.
- **Engineering**: code, configuration, pipelines; assisted review and maintenance.

## Core idea

What’s powerful is not “using a model” but **automating full decisions or flows** with explicit criteria and traceability.

## Four illustrative agent archetypes

### 1. Analyst agent

- Ingests structured or semi-structured data.
- Applies **rules and aggregations** before opaque heuristics.
- Produces **bounded hypotheses or scenarios** (not generic answers without context).
- AI contributes interpretation, synthesis, and wording on top of already computed results.

### 2. Supervisor / light compliance agent

- Watches operational signals (activity, deadlines, deviations from expected).
- Prioritizes **useful alerts** over noise; explains “why” in plain language.
- Fits as a layer on top of existing dashboards, queues, or logs.

### 3. Development support agent

- Traverses repositories or artifacts; spots obvious inconsistencies and suggests improvements.
- Integrates as CLI, hook, or assistant in the workflow (without replacing human review on critical paths).

### 4. Screening or ranking agent

- Applies declared criteria to filter, score, or rank candidates (items, tickets, opportunities).
- Output is **structured and auditable**; the model alone does not redefine business policy.

## Practical rule: when to add AI

1. Define rules and input/output contracts.
2. Automate with deterministic or measurable logic where possible.
3. Add AI to **explain, prioritize, summarize, or draft** on that foundation.

Starting with AI alone and no structure usually means **loss of control and repeatability**.

## Suggested actionable MVP (pattern)

- **Shape**: small, bounded piece (CLI, scheduled job, webhook, serverless function).
- **Input**: domain data in a stable format (API, file, queue, database).
- **Output**: states or labels defined by **explicit rules** (testable without a generative model).
- **Optional layer**: model only for narrative, prioritization among already valid results, or Q&A on the output.

*Mental template*: `data → rules → structured result → (optional) natural language`. The concrete domain is interchangeable.
