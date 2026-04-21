# MysticsHR Workspace

This is a pnpm monorepo containing the MysticsHR product (web client, API server, and shared libraries).

## Local checks

Run these from the repo root before opening a PR — they are also enforced by the
`PR Checks` GitHub Actions workflow (`.github/workflows/pr-checks.yml`).

- `pnpm run typecheck` — typechecks the shared libraries and every artifact / script package.
- `pnpm --filter @workspace/api-server run test` — runs the api-server vitest suite (currently covers orphan storage cleanup).

A failing api-server test will block the PR.
