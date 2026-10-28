# Canonical Working Style & Engineering Principles — {{userName}}

> **Document Status**: Canonical Baseline Working Style  
> **Source of Truth**: Version-Controlled Git (`users/WORKING_STYLE.md`)  
> **Author**: {{userFullName}}  
> **Generated**: {{generatedDate}}

---

## 1. Incremental Development & Vertical Slices

- **Step-by-Step Evolution**: Prefers building complete, working end-to-end vertical slices over broad, half-finished horizontal layers.
- **Verification Gates**: Every increment must be verified through automated tests, static typing, and operational inspection before moving to subsequent milestones.
- **Controlled Scope**: Reject scope creep. Keep each pull request or architectural milestone tightly focused on its specific objective.

---

## 2. Easy → Hard Progression

- **Foundational Contracts First**: Define types, interfaces, and baseline configurations before writing complex operational logic.
- **Deterministic Baselines**: Validate core flows with local deterministic behavior first, then connect cloud, distributed, or neural components.
- **Incremental Hardening**: Address edge cases, concurrency hazards, and network latency once the primary data flow is mathematically and logically sound.

---

## 3. Architectural Respect & Deep Investigation

- **Inspect Before Modifying**: Never guess how an existing subsystem functions. Read source files, inspect dependencies, check configuration, and trace execution paths before proposing edits.
- **Extend, Don't Compete**: When an abstraction already exists, extend and refine it cleanly rather than inventing a competing layer.
- **Respect Existing Conventions**: Align naming, file layout, and coding patterns with the prevailing codebase style.

---

## 4. Pragmatism vs. Accidental Complexity

- **Justified Complexity Only**: Sophisticated tools and abstractions are welcomed only when they cleanly solve core operational problems.
- **Zero Cosmetic Architecture**: Avoid theoretical abstractions, speculative database migrations, or enterprise patterns that solve no current problem.
- **Explicit Failure Handling**: Catch real errors, surface structured diagnostic data, and avoid fabricating false successes or synthetic responses.

---

## 5. Collaboration Contract with Alfred

- **Constructive Challenge**: Alfred is not a passive executor. When {{userName}} proposes an approach, Alfred should evaluate the trade-offs, identify hidden failure modes, and suggest refinements.
- **High-Velocity Delivery**: Be decisive. Provide clean code, precise diffs, and direct answers without unnecessary preliminary chatter.
- **Uphold Invariants**: Ensure system invariants (SSOT, privacy, type safety) remain unbroken across all commits.
