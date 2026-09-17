# Contributing to `@supabase/server`

Thank you for your interest in contributing to `@supabase/server`! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)
- [Contributing a middleware](#contributing-a-middleware)
- [Contributing a framework adapter](#contributing-a-framework-adapter)
- [Release Process](#release-process)

## Getting Started

TBD

## Development Setup

### Prerequisites

- **Node.js**: 20.x or higher
- **pnpm**

### Installation

1. Fork and clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/server.git
cd server
```

2. Install dependencies:

```bash
pnpm install
```

3. Build the project to verify setup:

```bash
pnpm build
```

## Development Workflow

### Building

Build the library for distribution:

```bash
pnpm build
```

Watch mode for development (rebuilds on file changes):

```bash
pnpm run dev
```

### Formatting

Format all code using Prettier:

```bash
pnpm format
```

## Testing

Run the unit and integration tests (no external dependencies needed):

```bash
pnpm test
```

### End-to-end tests

The E2E suite (`e2e/`) runs real JWT issuance, real JWKS validation, and real
Supabase client operations against a local Supabase stack, across all four
adapters. It imports the library from `dist/`, so build first:

```bash
pnpm build
cd e2e && supabase start && cd ..   # requires Docker
pnpm gen:env
pnpm test:e2e
```

See [`e2e/README.md`](e2e/README.md) for details. CI runs this suite in a
separate workflow (`.github/workflows/e2e.yml`).

### Trying a PR build

CI publishes every pull request as a preview package. From Node, install it by
PR number:

```bash
npm install https://pkg.pr.new/@supabase/server@<pr-number>
```

Deno's `npm:` specifier rejects tarball URLs, and an import map pointing at
an extracted `dist/index.mjs` passes `deno check` without checking anything,
so neither route exercises the build there. esm.sh serves the PR's commit
directly, subpaths included:

```ts
import { withSupabase } from 'https://esm.sh/pr/supabase/server/@supabase/server@<sha>?target=deno'
import { withPostgresClient } from 'https://esm.sh/pr/supabase/server/@supabase/server@<sha>/middleware/postgres?target=deno'
```

Pin the full commit sha, and add `&deps=@supabase/supabase-js@<version>` so
esm.sh resolves the peer to the version your project uses.

To try a release published to npm the same day, pass
`--minimum-dependency-age 0` to `deno check`. Deno 2.9 and later apply a
minimum dependency age to npm packages.

## Submitting Changes

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/) for automated releases. Format:

```text
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**

- `feat`: New feature (triggers minor version bump)
- `fix`: Bug fix (triggers patch version bump)
- `docs`: Documentation changes only
- `test`: Adding or updating tests
- `chore`: Maintenance tasks, dependency updates
- `refactor`: Code changes that neither fix bugs nor add features
- `perf`: Performance improvements
- `ci`: CI/CD configuration changes

**Breaking changes:**

- Use `feat!:` or `fix!:` for breaking changes (triggers major version bump)
- Or include `BREAKING CHANGE:` in the commit footer

**Examples:**

```bash
feat: add support for view operations
fix: handle empty namespace list correctly
docs: update README with new examples
test: add integration tests for table updates
feat!: change auth config structure

BREAKING CHANGE: auth configuration now uses a discriminated union
```

### Pull Request Process

1. **Create a branch** from `main`:

   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** following the guidelines above

3. **Commit** using conventional commit format:

   ```bash
   git commit -m "feat: add support for XYZ"
   ```

4. **Push** to your fork:

   ```bash
   git push origin feat/my-feature
   ```

5. **Open a Pull Request** with:
   - Clear title following conventional commit format
   - Description of what changed and why
   - Reference any related issues (e.g., "Fixes #123")
   - Screenshots/examples if adding user-facing features

6. **Respond to feedback** - maintainers may request changes

### PR Guidelines

- Keep PRs focused - one feature or fix per PR
- Update documentation if you change public APIs
- Add tests for new functionality
- Ensure all CI checks pass
- Rebase on `main` if needed to resolve conflicts
- Be responsive to review feedback

## Contributing a middleware

`@supabase/server` holds the middleware Supabase maintains. Two questions decide whether a middleware belongs here:

- Does it need Supabase? Keys, environment variables, a database connection, or Supabase API surface.
- Does it work with zero configuration? Installed and composed, it does the right thing on Supabase Edge Functions with no options.

Yes to both means it belongs here. `withSupabase`, `withSupabaseClient`, `withSupabaseAdminClient`, `withClaims`, `withRequiredClaims`, `withPostgresClient`, `withPostgresAdminClient`, and `withOAuthProtectedResource` all meet that bar.

Middleware with no Supabase surface does not belong here, even when Supabase writes it. Publish it as its own package on top of [`@supabase/middleware`](https://github.com/supabase/middleware); the engine's [authoring guide](https://github.com/supabase/middleware/blob/main/docs/authoring-guide.md) walks the full path. The engine itself ships only the composition primitives and two worked examples, so new middleware does not land there either.

**Layout.** A composable entry lives in `src/middleware/<name>/` with an `index.ts` and an `index.test.ts`, and exports from its own subpath, `@supabase/server/middleware/<name>`. Wire the subpath in `package.json#exports`, `tsdown.config.ts#entry`, and `jsr.json#exports`, and add its row to the import table in `README.md`. The existing entries are the template. The two auth gates, `withSupabase` and `withOAuthProtectedResource`, also export from the package root.

**Naming.** The `with` prefix means middleware: composable, chainable, and never the last entry in a chain. A terminal handler resolves the request instead of passing it on; it takes no prefix and lives outside `src/middleware/`. MCP-specific code stays separate from general middleware. When something turns out not to be MCP-specific, rename it and place it by the rules above.

## Contributing a framework adapter

Framework adapters (Hono, H3, …) are community-maintained and live in this repo under `src/adapters/`. They have **additional requirements** on top of the general PR guidelines above — tests covering every auth mode, no new runtime deps beyond a peer-dep, matching the existing adapter shape, and updating both adapter tables (in `README.md` and `src/adapters/README.md`).

See [`src/adapters/README.md`](src/adapters/README.md) for the full checklist before opening an adapter PR.

## Release Process

This project uses [release-please](https://github.com/googleapis/release-please) for automated releases. You don't need to manually manage versions or changelogs.

### How It Works

1. **You commit** using conventional commit format (see above)

2. **release-please creates/updates a release PR** automatically when changes are pushed to `main`
   - Updates version in `package.json`
   - Updates `CHANGELOG.md`
   - Generates release notes

3. **Maintainer merges the release PR** when ready to release
   - Creates a GitHub release and git tag
   - Automatically publishes to npm with provenance

### Version Bumps

Versions follow [Semantic Versioning](https://semver.org/):

- **Major (1.0.0 → 2.0.0)**: Breaking changes (`feat!:`, `fix!:`, or `BREAKING CHANGE:`)
- **Minor (1.0.0 → 1.1.0)**: New features (`feat:`)
- **Patch (1.0.0 → 1.0.1)**: Bug fixes (`fix:`)

Commits with types like `docs:`, `test:`, `chore:` don't trigger releases on their own.

### For Maintainers Only

Publishing is fully automated via GitHub Actions:

1. Merge the release-please PR when ready
2. GitHub Actions will automatically publish to npm with provenance
3. No manual `npm publish` needed

## Questions?

- Open an [issue](https://github.com/supabase/server/issues) for bugs or feature requests
- Check existing issues and PRs before creating new ones
- Tag your issues appropriately (`bug`, `enhancement`, `documentation`, etc.)

## License

By contributing to `@supabase/server`, you agree that your contributions will be licensed under the MIT License.
