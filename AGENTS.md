# MysticsHR Workspace

This is a pnpm monorepo containing the MysticsHR product (web client, API server, and shared libraries).

## Local checks

Run these from the repo root before opening a PR — they are also enforced by the
`PR Checks` GitHub Actions workflow (`.github/workflows/pr-checks.yml`).

- `pnpm run typecheck` — typechecks the shared libraries and every artifact / script package.
- `pnpm -r --if-present run test` — runs the test suites in every package that defines a `test` script (api-server, web client, shared libs).

A failing test in any package will block the PR.
