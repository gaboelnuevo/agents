# Market fit: is there room for this product?

Analysis based on the conversation and brainstorm documents (`00`–`09`, especially product vision in `01`, `02`, `03`, and the core summary in `09-core-engine`). Goal: position a **stateful agent runtime** (memory, skills, tools under engine control, `thought/action/observation/wait/result` protocol, wait/resume, multi-agent, dynamic definition) against the current market and decide whether the gap favors **SaaS**, **open source library**, or a **combination**.

---

## 1. What you are proposing (reminder)

Not “another chat with a model API.” It is a **control system** over the LLM: explicit contracts, append-only history, effects only via engine/adapters, pauses until the real world, same semantics in **SDK / CLI / REST**, and a path to **multi-tenant** (project, session, security). That matches the brainstorm thesis: **automate flows and decisions with traceability**, not loose answers ([`01-context-and-ideas.md`](./01-context-and-ideas.md)).

That definition is the compass for market fit: the buyer or adopter wants **governance + repeatability + integration in their stack**, not just “more model.”

---

## 2. The market already has many pieces (but fragmented)

| Category | What they cover well | Where they are often “thin” vs your vision |
|----------|----------------------|---------------------------------------------|
| **Agent SDKs and frameworks** (graphs, teams, LLM orchestration) | Loops, tools, sometimes persistence or human-in-the-loop | Different mental model per framework; less emphasis on a **single** engine–LLM–tools **protocol**; multi-tenant and **SecurityLayer** as a product primitive are not always solved out of the box. |
| **Low-code / automation + AI platforms** | Triggers, integrations, non-technical users | Black box, hard to version configs as code, less fine control of the loop and **wait/resume** as a first-class contract. |
| **Provider assistant / thread APIs** | Managed conversation state | Vendor lock-in, fewer **skills**, **multi-agent bus**, and dynamic **define** under your scope policy. |
| **Workflow engines** (queues, sagas, durable execution) | Temporal reliability, retries | **Cognition** (what the LLM does each step, `Step` parsing, re-prompt) is usually your job; they do not replace a coherent **Agent Engine**. |
| **MCP and similar** | Expose tools to models and hosts | They are **plugs**, not the agent OS ([`docs/core/01-purpose.md`](../core/01-purpose.md)): they do not replace native memory, loop, or execution policy. |

Intermediate conclusion: the market is **not** short of “AI”; it often lacks a **thin but strict layer** that unifies: state, protocol, tools executed only by the engine, durable pauses, adoption in **both** code **and** ops (CLI/API), with clear history for audit.

That **can** be a gap, as long as the message is not generic (“build agents with AI”) but **vertical or use-case driven** ([`02-micro-saas-playground.md`](./02-micro-saas-playground.md)).

---

## 3. Is there room for an open source library?

**Yes, with nuance.**

**In favor of the OSS gap**

- Teams with their own backend want **control**, tests, and to avoid black boxes; a library with clear contracts (MemoryAdapter, ToolRunner, `Step`, wait/resume) fits **serious engineering** and the brainstorm pattern `data → rules → structured result → (optional) NL`.
- The OSS agent ecosystem is **hot but heterogeneous**: room for a project positioned as **“execution engine with invariants”** (LLM does not execute tools, immutable history, state outside the prompt) instead of just another graph wrapper.
- CLI + SDK sharing semantics is an **adoption hook** for devs and SRE (debugging, reproducible runs).

**Against or risks OSS**

- Maintenance, documentation, and multi-provider compatibility take time.
- Without a clear narrative, it gets lumped with “another Lang*.”
- Direct OSS monetization is weak unless support, cloud hosted, or dual license.

**Library verdict:** the gap **exists** for anyone who needs a **governed runtime** embedded in Node (or another aligned runtime). The differentiator should be communicated as **3–5 engine invariants**, not “we support GPT-X.”

---

## 4. Is there room for SaaS?

**Yes, but narrower and more exposed to saturation.**

**In favor**

- Anyone who does not want to run Redis, queues, or deployments will pay for **hosted runs**, schedules, webhooks, and dashboards ([`02-micro-saas-playground.md`](./02-micro-saas-playground.md): triggers, blocks, JSON export).
- Verticalization (e.g. internal ops, customer support, field service, light compliance) reduces comparison with “100 agent startups.”

**Against**

- Generic “agent builder” messaging competes with incumbents and AI marketing noise ([`02`](./02-micro-saas-playground.md) already warns of this).
- Enterprise buyers ask about **isolation, audit, SLAs**; that needs a mature product, not UI only.

**SaaS verdict:** the gap is **real** as a **hosted** layer on the same engine (or as a vertical product), not as generic “chat SaaS.” The barrier is **positioning and a demonstrable use case** (brainstorm insight: *complex systems + real cases*).

---

## 5. Recommended strategy: one engine, two distribution paths

Aligned with core + brainstorm docs:

1. **Core (ideally OSS or at least open engine code)**  
   Adoption, trust, community extensions, adapters (memory, Upstash, etc.).

2. **Optional cloud product**  
   Managed execution, multi-tenant, API keys, quotas, vertical templates — **same semantics** as self-hosted SDK ([`09-core-engine.md`](./09-core-engine.md), consumers in [`14-consumers.md`](../core/14-consumers.md)).

This avoids the false dichotomy “SaaS only vs library only”: strong **market fit** is often **OSS/core + hosted** (similar to databases, workflow engines, and many infra tools).

---

## 6. Product signals that validate (or invalidate) the gap

**Validate that the market needs you**

- They ask for **audit** of reasoning and actions (history like `thought → action → observation`).
- They need to **pause** until human, webhook, or time without hand-rolled state machines.
- They want the **same contract** in internal backend and external integrations (REST/webhooks).

**Invalidate or weaken**

- They only want chat with RAG: provider products already cover that.
- They have no rules or structured outputs: your value thesis ([`01`](./01-context-and-ideas.md)) does not apply.

---

## 7. Executive summary

| Question | Short answer |
|----------|----------------|
| Is there a gap? | **Yes**, at the intersection of **state + protocol + controlled execution + wait/resume + operability (CLI/API)**, not “more LLM.” |
| OSS library? | **Solid gap** if the message is **engine with invariants** and clear adapters; you compete with fragmentation, not absence of code. |
| SaaS? | **Conditional gap**: viable as **hosted same engine** or **vertical**; risky as “another generic agent builder.” |
| What to do first? | Aligned with [`02`](./02-micro-saas-playground.md) and [`mvp`](../planning/mvp.md): **engine and one real case** before fancy UI; OSS core accelerates technical credibility; SaaS later if there is demand for delegated ops. |

This document is **strategy and framing**; implementation detail remains in [`docs/core/`](../core/README.md) and the pitch in [`00-elevator-pitch.md`](./00-elevator-pitch.md).
