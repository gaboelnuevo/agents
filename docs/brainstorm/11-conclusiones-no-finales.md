# Non-final conclusions (brainstorm + core)

**Provisional** synthesis crossing [`docs/brainstorm/`](./) and [`docs/core/`](../core/README.md). It does not close the design or replace the numbered documents; it aligns vision before final decisions.

---

## Vision and problem

- Strong focus on **automating flows and decisions** with **explicit criteria and traceability**, not “more chat with a model” (see [`01-contexto-e-ideas.md`](./01-contexto-e-ideas.md), [`00-elevator-pitch.md`](./00-elevator-pitch.md)).
- AI fits better **after** rules and structured outputs; model-only without contracts leads to **loss of control and repeatability**.

## What the technical product is

- An **Agent Engine / runtime**: the LLM is **inference**; the engine is **control** (loop, step parsing, tools, memory, wait/resume) ([`../core/01-purpose.md`](../core/01-purpose.md), [`../core/03-execution-model.md`](../core/03-execution-model.md), [`../core/04-protocol.md`](../core/04-protocol.md)).
- Articulated differentiators: **layered memory**, **skills vs tools** with execution only via **ToolRunner**, **typed protocol** (`thought` / `action` / `observation` / `wait` / `result`), **append-only history**, **durable state outside the prompt** ([`../core/05-adapters.md`](../core/05-adapters.md), [`../core/12-skills.md`](../core/12-skills.md)).
- **Wait/resume** as a first-class primitive fits the real world (human, webhook, time), not only chat turns ([`04-protocolo-comunicacion-y-loop.md`](./04-protocolo-comunicacion-y-loop.md)).

## Delivery shape

- **Same semantics** in **SDK (Promise + hooks)**, **CLI**, and **REST** avoids duplicating the loop and helps dev + ops adoption ([`05-sdk-estilo-promise-y-prd.md`](./05-sdk-estilo-promise-y-prd.md), [`06-libreria-adapters-cli.md`](./06-libreria-adapters-cli.md), [`07-multi-agente-rest-sesiones.md`](./07-multi-agente-rest-sesiones.md), [`../core/14-consumers.md`](../core/14-consumers.md)).
- **Multi-agent** as **MessageBus + tool** (`send_message`), not one mega-model with many voices; still one loop per agent ([`../core/09-communication-multiagent.md`](../core/09-communication-multiagent.md)).
- **Dynamic platform** (`Agent.define` / `Tool.define` / `Skill.define`, project vs global) is **evolutionary vision**, not mandatory for engine MVP ([`08-plataforma-dinamica-proyectos.md`](./08-plataforma-dinamica-proyectos.md), [`../core/07-definition-syntax.md`](../core/07-definition-syntax.md), [`../core/06-mvp.md`](../core/06-mvp.md)).

## Security and serious product

- **SecurityLayer before the engine** + scopes **global → project → session → run** frame multi-tenant and coherent permissions ([`../core/08-scope-and-security.md`](../core/08-scope-and-security.md)).
- **Context Builder** filters which tools the model sees by agent + principal; reduces abuse surface ([`../core/11-context-builder.md`](../core/11-context-builder.md)).

## MVP and risks (detail still open)

- Core MVP: **one reference agent**, bounded loop, validated JSON/`Step`, minimal memory, memory tools, **wait/resume**, hooks; **Upstash** as optional adapter, **no** core coupling ([`../core/06-mvp.md`](../core/06-mvp.md)).
- Recurring risks: long loops, invalid JSON, inconsistent `waiting` state, dangerous tools — mitigation sketched in core (limits, bounded re-prompt, snapshots, allowlist) ([`../core/13-errors-parsing-and-recovery.md`](../core/13-errors-parsing-and-recovery.md)).

## Market (non-final)

- The **gap** is framed as **governed execution + protocol + pauses + operability**, not “lack of AI” ([`10-market-fit.md`](./10-market-fit.md)).
- **OSS library** fits strongly if the message is **engine invariants**; **SaaS** fits as **hosted same engine** or **vertical**, not as a generic builder ([`02-micro-saas-playground.md`](./02-micro-saas-playground.md)).

## Still open (expected in brainstorm)

- Concrete **vertical** (industry-specific vs horizontal internal tools): direction suggested in docs, not a single decision.
- **Exact order** commercial vs technical (OSS only first vs cloud soon): hybrid recommendation in [`10-market-fit.md`](./10-market-fit.md), not a fixed commitment.
- **LLM provider**, stores, and hosting: swappable by design; concrete choices are implementation ([`../core/10-llm-adapter.md`](../core/10-llm-adapter.md)).

## One line (reminder)

To move from “non-final” to “decided” you need **one measurable pilot use case**, **explicit v1 limits** (which parts of the dynamic platform ship or not), and **user validation** on whether they prioritize **self-hosted** or **hosted**.

---

## Related reading

| Doc | Role |
|-----|------|
| [`09-core-engine.md`](./09-core-engine.md) | Bridge brainstorm → `docs/core` |
| [`10-market-fit.md`](./10-market-fit.md) | SaaS vs OSS, market gap |
| [`../core/README.md`](../core/README.md) | Engine index |
