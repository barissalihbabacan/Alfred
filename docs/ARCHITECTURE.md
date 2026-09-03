# Architecture Principles — B.U.T.L.E.R. Alfred

This document defines the core architecture principles, directory boundaries, and separation of concerns for B.U.T.L.E.R. Alfred.

---

## ALFRED

The `src/alfred/` directory contains Alfred's domain and cognitive architecture.

It should remain as vendor-independent as reasonably possible, shielding the core personality and reasoning logic from specific external provider APIs and vendor lock-in.

---

## Cognitive Layer

The Cognitive Layer (`src/alfred/cognitive/`) represents Alfred's understanding of:

- **Context**: Current operational environment, user state, and task scope.
- **Memory**: Episodic, semantic, and working memories across interactions.
- **Projects**: High-level initiatives, goals, and trackable milestones.
- **Decisions**: Historical choices, rationale, and decision boundaries.
- **Dependencies**: Prerequisites, blockers, and inter-task relationships.
- **Attention**: Prioritization focus, interrupt handling, and relevance filtering.

---

## Control Plane

The Control Plane (`src/alfred/control-plane/`) is responsible for:

- **Planning**: Decomposition of goals into ordered, executable steps.
- **Tool routing**: Determining appropriate execution channels and tool selection.
- **Scheduler**: Managing recurring jobs, asynchronous timeouts, and cron schedules.
- **Event processing**: Ingesting, filtering, and dispatching inbound events.
- **Permissions**: Enforcing security boundaries, user approval gates, and authority tiers.

---

## Execution Plane

The Execution Plane (`src/alfred/execution-plane/`) contains capabilities Alfred can execute through tools and integrations:

- **GitHub**: Repository management, pull requests, issue tracking, and actions.
- **Gmail**: Email triage, drafting, reading, and inbox management.
- **Calendar**: Event scheduling, conflict detection, and agenda management.
- **Files**: Local workspace filesystem interaction and document processing.
- **Browser**: Automated web interaction, navigation, and page inspection.
- **Terminal**: Shell command execution and script invocation.
- **Web Search**: Information discovery and web queries.
- **External APIs**: Third-party API invocations and REST/GraphQL interactions.

---

## AI Layer

The `src/ai/` directory contains:

- **Agents**: Autonomous agent loops and subagent orchestration.
- **Tools**: Tool definitions, function schemas, and tool execution wrappers.
- **Prompts**: System instructions, persona guidelines, and templated prompts.
- **Model providers**: Model client abstractions (e.g., Anthropic, OpenAI, Gemini).
- **Middleware**: Rate limiting, token tracking, logging, and guardrails.

*The AI layer should orchestrate Alfred rather than becoming Alfred's permanent state store.*

---

## Data Layer

The `src/data/` directory represents persistence and data-access abstractions:

- **Firestore**: Remote document store for persistent cloud synchronization.
- **Vector**: Local vector database for semantic search and memory embeddings.
- **GraphQL**: Structured data queries and type schemas.
- **Repositories**: Abstract repository pattern implementations decoupling data access from business logic.
- **Schemas**: Data contracts, validation rules, and entity types.

*Keep persistence implementation details separated from Alfred's domain logic.*

---

## Integrations

The `src/integrations/` directory contains external-service clients, authentication, API adapters, and provider-specific implementation details. Integrations translate generic execution requests into vendor-specific API calls.
