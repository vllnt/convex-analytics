# Contributing to convex-analytics

Thanks for your interest in contributing! This guide covers the setup, conventions, and PR process.

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+ (`npm install -g pnpm`)

## Setup

```bash
git clone https://github.com/bntvllnt/convex-analytics.git
cd convex-analytics
pnpm install
pnpm build
pnpm test
```

## Development Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature   # or fix/, chore/, docs/
   ```

2. **Make your changes** — see the package structure in `CLAUDE.md` or `AGENTS.md`.

3. **Run checks**:
   ```bash
   pnpm typecheck   # Type-check all packages
   pnpm lint        # Lint all packages
   pnpm test        # Run all tests
   pnpm build       # Ensure build succeeds
   ```

4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(analytics): add new breakdown dimension
   fix(mcp): handle empty timeseries response
   docs: update API reference
   chore: bump dependencies
   ```

5. **Open a PR** against `main`.

## Branch Naming

| Prefix | Use |
|--------|-----|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `chore/` | Maintenance, deps, CI |
| `docs/` | Documentation only |

## Code Style

- **TypeScript strict mode** — no `any` (use `unknown` + type guards)
- **Explicit return types** on exported functions
- **Convex validators** (`v.string()`, `v.number()`) — not Zod
- **Indexes first** — always use `.withIndex()` for database queries
- **No `.collect()` on large tables** — use `.take(limit)`
- **Mutations return `v.null()`** explicitly

## Testing

Tests use **Vitest** with **convex-test**. Test files live in `packages/convex-analytics/tests/`.

```bash
pnpm test                    # Run all tests
cd packages/convex-analytics
pnpm vitest run              # Run just this package's tests
pnpm vitest run --reporter=verbose  # Verbose output
```

When adding features or fixing bugs, include tests that cover your change.

## PR Process

1. All checks must pass (typecheck, lint, test, build)
2. PRs are squash-merged into `main`
3. Keep PRs focused — one feature or fix per PR
4. Update docs if you change public API or behavior

## Project Structure

See `CLAUDE.md` for the full package layout, key patterns, and common pitfalls.

## Documentation

When changing public API or behavior, update the relevant files in `docs/`:

| Change | Update |
|--------|--------|
| New endpoint or changed params | `docs/api-reference.md` |
| Client SDK method change | `docs/client-sdk.md` |
| Schema change | `docs/schema.md` |
| New cron or write path change | `docs/architecture.md` |
| New MCP tool | `docs/mcp-tools.md` |
| New scoping field | `docs/multi-product.md` |

After updating `docs/`, also update `llms-full.txt` (concatenation of all docs).

## Community

- [Code of Conduct](CODE_OF_CONDUCT.md) — expected behavior
- [Security Policy](SECURITY.md) — report vulnerabilities privately

## Questions?

- [Discord](https://bntvllnt.com/discord) — ask questions, share feedback
- [X / Twitter](https://bntvllnt.com/x) — follow for updates
- Or open an issue on GitHub
