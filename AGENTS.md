# ChessReplay development conventions

- Keep a backend-first modular monolith. Organize features by capability and keep HTTP handlers, use cases, and external I/O responsibilities clear.
- Use strict TypeScript and Nest dependency injection. Introduce shared abstractions when concrete callers need them.
- Validate request, configuration, and provider data at their boundaries. Keep credentials in environment variables and omit them from logs, responses, fixtures, and commits.
- Use PostgreSQL constraints for data invariants. Commit reviewable Prisma migrations with future schema changes. Keep generated clients out of source control.
- Use deterministic fixtures or stubs for external services. Test HTTP contracts at the HTTP boundary and verify database behavior against PostgreSQL when it matters.
- Use Node.js 24 LTS and npm. Update the lockfile with dependency changes. See the README for verification commands.

## AI-assisted development

- Keep changes within the currently approved task. Ask before proceeding to the next milestone or taking destructive actions.
- Read relevant project code before editing. Preserve existing behavior and avoid speculative dependencies, infrastructure, and refactors.
- Run the relevant checks, report results and gaps, and explain decisions that affect correctness or maintainability.

## Approved product decisions

- The first import milestone will save one eligible game. The MVP will import up to 20 recent completed standard chess games in rapid, blitz, and bullet.
- Prefer Chess.com's game UUID. Document the fallback for missing UUIDs when implementing source identity and enforce uniqueness in PostgreSQL.
- Preserve original PGN and relevant source metadata. Keep Game independent of Learner and training progress.
- Distinguish an exhausted search with no eligible game from upstream errors and incomplete scans.
- Redis, BullMQ, Stockfish, authentication, and frontend work are outside the first milestone.
