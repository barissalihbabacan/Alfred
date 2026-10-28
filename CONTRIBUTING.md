# Contributing to Alfred

Thank you for your interest in contributing to Alfred!

Alfred is an open-source, self-hosted personal AI butler and senior software engineering partner. We hold ourselves to high engineering standards: strict type safety, zero data loss, verified objection logic, and rigorous differential testing.

---

## Code of Conduct

All contributors and participants are expected to adhere to the [Code of Conduct](./CODE_OF_CONDUCT.md). Please read it before engaging with the project.

---

## Core Principles

1. **Strict TypeScript**: We run with strict TypeScript compiler options (`allowImportingTsExtensions`, no untyped `any`, no implicit conversions). Every export and function signature must be strongly typed.
2. **Privacy First**: Secrets (API keys, passwords, bearer tokens) must never enter Firestore vector storage or logs. All user memory persistence passes through autonomous privacy scrubbers.
3. **Reasoned Objection over Sycophancy**: Alfred is designed to reject dangerous commands (dropping production databases, bypassing tests, executing unvetted scripts). Any contribution modifying prompts or safety policies must preserve this core behavior.
4. **Differential Invariants**: Core business logic (memory extraction, time resolution, write planners) is backed by thousands of randomized differential tests to prevent regressions against production.

---

## Getting Started

### Prerequisites

- **Node.js**: v22 or higher
- **npm**: v10 or higher
- **Firebase CLI** (optional for local emulators): `npm install -g firebase-tools`

### Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/barissalihbabacan/Alfred.git
   cd Alfred
   ```

2. **Install dependencies:**
   ```bash
   npm ci
   cd functions && npm ci && cd ..
   ```

3. **Initialize personal profile digest:**
   ```bash
   npm run profile:init
   ```

4. **Configure environment:**
   ```bash
   cp .env.example .env
   # Add your test API keys and authorization whitelist
   ```

---

## Development Workflow

### Branch Naming Conventions

Create a topic branch from `main`:
- `feat/feature-name` for new capabilities
- `fix/bug-description` for bug fixes
- `refactor/scope-name` for architectural refactoring
- `docs/topic-name` for documentation improvements
- `chore/tool-name` for tooling and dependency upgrades

### Running Checks Locally

Before opening a pull request, run the full validation suite locally:

```bash
# 1. Lint code
npm run lint

# 2. Typecheck root and functions
npm run typecheck

# 3. Typecheck tests and scripts
npm run typecheck:tests

# 4. Run unit test suite (968 tests)
npm run test:unit

# 5. Verify web build (if modifying apps/web)
npm run build:web
```

---

## Pull Request Guidelines

1. **Branch Protection**: Direct pushes to `main` are restricted. All changes must be submitted via a Pull Request.
2. **Status Checks Required**: The `Typecheck & Unit Tests` GitHub Actions workflow must pass completely before merging.
3. **Review Required**: Every PR requires at least 1 approving review from a maintainer.
4. **Conventional Commits**: Format commit messages cleanly:
   - `feat(scope): concise description`
   - `fix(scope): concise description`
   - `refactor(scope): concise description`
   - `docs(scope): concise description`
   - `test(scope): concise description`
5. **No Secrets**: Double-check diffs to ensure no `.env` files, API keys, or private identifiers are accidentally committed.

---

## Issue Guidelines

- Use the official [Issue Templates](https://github.com/barissalihbabacan/Alfred/issues/new/choose) for Bug Reports and Feature Requests.
- For security vulnerabilities, refer to [SECURITY.md](./SECURITY.md) for private disclosure instructions.
