## Summary

<!-- Briefly describe the problem this PR addresses and the approach taken. -->

## Type of Change

- [ ] `feat`: New feature or capability
- [ ] `fix`: Bug fix
- [ ] `refactor`: Code refactoring without behavior change
- [ ] `perf`: Performance improvement
- [ ] `docs`: Documentation updates
- [ ] `test`: New or updated tests
- [ ] `chore`: Tooling, build scripts, or dependencies

## Scope of Impact

<!-- Which parts of Alfred are affected? Check all that apply: -->
- [ ] `functions/` (Cloud Functions 2nd Gen, SSE streaming, Auth gateway)
- [ ] `src/ai/` (Model failover chain: Groq, Gemini, Ollama, EVREN, tools)
- [ ] `src/alfred/` (Memory extraction pipeline, persona prompt, privacy filter)
- [ ] `src/data/` (Firestore schemas, vector store, embeddings)
- [ ] `apps/web/` (Next.js 16 frontend, voice interface, PWA)
- [ ] `docs/` or `assets/` (Documentation, diagrams, visual assets)

## Pre-Merge Checklist

All checks must pass before this PR can be merged:

- [ ] **Lint**: `npm run lint` passes with 0 errors and 0 warnings.
- [ ] **Typecheck**: `npm run typecheck` passes with 0 errors.
- [ ] **Tests Typecheck**: `npm run typecheck:tests` passes with 0 errors.
- [ ] **Unit Tests**: `npm run test:unit` passes (all unit test suites green).
- [ ] **Web Build** (if `apps/web` modified): `npm run build:web` succeeds.
- [ ] **Privacy & Secrets**: Verified no API keys, credentials, or personal tokens are included.
- [ ] **Documentation**: Corresponding updates made to `README.md` and `README.tr.md` (if applicable).
- [ ] **Differential Invariants**: Core behavior preserved against regressions.

## Verification & Testing

<!-- Describe the specific tests executed and include relevant outputs or logs. -->

```bash
# Commands executed to verify this change:
npm run lint
npm run typecheck
npm run test:unit
```
