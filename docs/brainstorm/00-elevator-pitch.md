# Elevator pitch

Project summary based on the documents in this folder (`01`–`08`).

## ~20–30 seconds (elevator)

I'm building a **stateful agent runtime**: not a chat wrapper, but an engine where each agent has **persistent memory**, **skills**, and **tools** that **only the engine executes**—the model proposes, the system validates and acts. Communication is **via structured messages**, with **wait and resume** when the real world is needed, and the same semantics in **code (Promise-style SDK with hooks)**, **CLI**, and later **REST**. The goal is to **automate full flows with clear rules and traceability**, not “more generic AI.”

## ~45–60 seconds

Most products stop at “call the model.” I'm aiming at **decisions and complete flows**: explicit data and contracts, auditable outputs, and AI to **interpret, prioritize, or draft** on top of something already measurable. Technically it's an **Agent Runtime** decoupled from the LLM vendor: layered memory, loop with **thought / action / observation / wait / result**, and **multi-agent** via a message bus. On top, **dynamic definition** of agents, tools, and skills (per project and global resources) so nothing is “hard-coded” in source. In short: **a lightweight OS for agents** that teams can operate, observe, and version.

## One line (tagline)

**Agent runtime with memory, tools under control, and pausable flows—same semantics in code, CLI, and API.**
