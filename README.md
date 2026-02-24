# @supabase/edge-functions

> TBD

## Development

```bash
pnpm install
pnpm dev
```

## Commit Conventions

This repo enforces [Conventional Commits](https://www.conventionalcommits.org/) via a git hook. Every commit message must follow:

```
type(scope): description
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## Formatting

Prettier runs automatically on staged files before each commit via `simple-git-hooks` and `pretty-quick`. No manual formatting step needed.

To format the entire project manually:

```bash
pnpm format
```

## Releases

Production releases are fully automated with [release-please](https://github.com/googleapis/release-please). On every push to `main`, release-please opens (or updates) a release PR that bumps the version and generates a changelog. Merging that PR triggers a build and publishes to npm with provenance.

## Preview Releases

Every pull request automatically publishes a preview package via [pkg-pr-new](https://github.com/nicolo-ribaudo/pkg-pr-new). An install link is posted as a PR comment so you can test changes before merging.

## License

MIT
