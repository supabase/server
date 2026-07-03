# Changelog

## [1.3.0](https://github.com/supabase/server/compare/server-v1.2.0...server-v1.3.0) (2026-07-03)

### Features

- add attw type export checking to CI ([#93](https://github.com/supabase/server/issues/93)) ([e1e2b72](https://github.com/supabase/server/commit/e1e2b72e81660c787b0445dbdf69946b95324abd))

### Bug Fixes

- add ./peer/supabase-js to jsr.json exports ([#94](https://github.com/supabase/server/issues/94)) ([04276d0](https://github.com/supabase/server/commit/04276d015c8b65f50c1944a9e8407fe01f444703))
- **test:** correct sub claim in remote JWKS token fixture and wire tests into CI ([#89](https://github.com/supabase/server/issues/89)) ([744105b](https://github.com/supabase/server/commit/744105b458e637b5211021d3e6b9de2d91da6b72))

## [1.2.0](https://github.com/supabase/server/compare/server-v1.1.0...server-v1.2.0) (2026-06-17)

### Features

- add NestJS adapter ([#55](https://github.com/supabase/server/issues/55)) ([3052a6b](https://github.com/supabase/server/commit/3052a6b30931f0478bfc4f9dcd25505292b585a9))
- add support for `HS256` JWKs ([#83](https://github.com/supabase/server/issues/83)) ([67c840d](https://github.com/supabase/server/commit/67c840dc5e8df9374877ca94dc6b6e278e4b13f9))

### Bug Fixes

- **docs:** Replace manual context casting with Hono Env type ([#77](https://github.com/supabase/server/issues/77)) ([5ac7ccf](https://github.com/supabase/server/commit/5ac7ccf629c246164659b8c1dc329c3e3066ff14))
- **test:** lint regression in hono tests ([#79](https://github.com/supabase/server/issues/79)) ([182412b](https://github.com/supabase/server/commit/182412b2f0586fa942a6b6d2662fddf0776da9cf))

## [1.1.0](https://github.com/supabase/server/compare/server-v1.0.0...server-v1.1.0) (2026-05-19)

### Features

- add Elysia adapter ([#46](https://github.com/supabase/server/issues/46)) ([148169e](https://github.com/supabase/server/commit/148169e5f7737ea50049f3649056f5a44a266a1f))
- **env:** add support for JWKS discovery endpoints ([#53](https://github.com/supabase/server/issues/53)) ([45d677a](https://github.com/supabase/server/commit/45d677ae6539cfa58e0c339960f53e9a7ca90e7d))

### Bug Fixes

- **auth:** skip user mode when token has sb\_ prefix ([#67](https://github.com/supabase/server/issues/67)) ([b193216](https://github.com/supabase/server/commit/b1932169e28163040b9b22db73b0f84739d9bb8b))
- **ci:** update node packages ([#57](https://github.com/supabase/server/issues/57)) ([f275907](https://github.com/supabase/server/commit/f2759071fd84932e15ebd48f21c04ab311bd5237))
- **jsr:** resolve slow-type errors in elysia and h3 adapters ([#69](https://github.com/supabase/server/issues/69)) ([7c56b13](https://github.com/supabase/server/commit/7c56b132985bd04673108dab7251b1939326d18e))

## [1.0.0](https://github.com/supabase/server/compare/server-v0.2.0...server-v1.0.0) (2026-05-06)

### Miscellaneous Chores

- release 1.0.0 ([#50](https://github.com/supabase/server/issues/50)) ([67de77f](https://github.com/supabase/server/commit/67de77f00b7ebbf4e1de973489703959c7e3a838))

## [0.2.0](https://github.com/supabase/server/compare/server-v0.1.4...server-v0.2.0) (2026-04-24)

### ⚠ BREAKING CHANGES

- when multiple auth modes are allowed, a present-but-invalid JWT is now rejected with InvalidCredentialsError instead of falling through to the next mode. Clients that previously relied on silent fallthrough (e.g., stale token + valid apikey) must now either omit the Authorization header or refresh the token.

### Features

- add H3 adapter ([#36](https://github.com/supabase/server/issues/36)) ([4310142](https://github.com/supabase/server/commit/43101427e64c01b986376ca5d94c5e008d0adcdf))

### Bug Fixes

- reject invalid JWTs immediately instead of falling through to next auth mode ([#35](https://github.com/supabase/server/issues/35)) ([0251690](https://github.com/supabase/server/commit/0251690a7f57eb3e2d72074348d8a96f5fb55231))

## [0.1.4](https://github.com/supabase/server/compare/server-v0.1.3...server-v0.1.4) (2026-04-01)

### Features

- add `supabaseOptions` and refactor client creation to options objects ([#19](https://github.com/supabase/server/issues/19)) ([5a10099](https://github.com/supabase/server/commit/5a100995a1b6254f92768c82c74b1c754c29b3b2))
- exposing `keyName` to `SupabaseContext` ([#22](https://github.com/supabase/server/issues/22)) ([7f1b1a7](https://github.com/supabase/server/commit/7f1b1a75cc98d08a63275131481e5df825c10afb))
- implement server-side DX primitives, wrappers, and adapters ([#6](https://github.com/supabase/server/issues/6)) ([d206e5c](https://github.com/supabase/server/commit/d206e5cdb102bf96e0c501b72e7f161cbf9fba0c))
- passing down Database generic type to `createClient` ([#16](https://github.com/supabase/server/issues/16)) ([4053f6d](https://github.com/supabase/server/commit/4053f6d8db89201a239190a025b08cf19083acb4))
- set initial release version ([8352bda](https://github.com/supabase/server/commit/8352bda35c5967a6692f0a21744d30793e10709a))
- standardize error response ([#18](https://github.com/supabase/server/issues/18)) ([a7ddb74](https://github.com/supabase/server/commit/a7ddb74bfbbe4565d461be7df7f01e64854f6c06))

### Bug Fixes

- key name resolution for client creation ([#9](https://github.com/supabase/server/issues/9)) ([e17bd4e](https://github.com/supabase/server/commit/e17bd4ecb1c46d0dc1468f363c884090d78ae86a))
- move SKILL.md into skills/ subdirectory to align with agentskills spec ([#24](https://github.com/supabase/server/issues/24)) ([10c8780](https://github.com/supabase/server/commit/10c8780cc21de3bb860d2ec8bf5589f69d4ea447))
- release action ([#29](https://github.com/supabase/server/issues/29)) ([91580d1](https://github.com/supabase/server/commit/91580d11fd1217a22da1150757114ee980d6157b))
- remove provenance until repo is public ([2ebbc71](https://github.com/supabase/server/commit/2ebbc71e214c4bbae62c6af203a039801b5e3d4d))
- removing `core` lib exports from root index ([#17](https://github.com/supabase/server/issues/17)) ([5e53e3c](https://github.com/supabase/server/commit/5e53e3c14fcc7c198f1c0bbec9089b4aedd91473))
- support bare array format for SUPABASE_JWKS ([#8](https://github.com/supabase/server/issues/8)) ([6bd2e4d](https://github.com/supabase/server/commit/6bd2e4dfc1b60ce4cc8a1b59435b87797e1cb017))

## [0.1.3](https://github.com/supabase/server/compare/server-v0.1.2...server-v0.1.3) (2026-04-01)

### Bug Fixes

- move SKILL.md into skills/ subdirectory to align with agentskills spec ([#24](https://github.com/supabase/server/issues/24)) ([10c8780](https://github.com/supabase/server/commit/10c8780cc21de3bb860d2ec8bf5589f69d4ea447))

## [0.1.2](https://github.com/supabase/server/compare/server-v0.1.1...server-v0.1.2) (2026-04-01)

### Features

- exposing `keyName` to `SupabaseContext` ([#22](https://github.com/supabase/server/issues/22)) ([7f1b1a7](https://github.com/supabase/server/commit/7f1b1a75cc98d08a63275131481e5df825c10afb))

## [0.1.1](https://github.com/supabase/server/compare/server-v0.1.0...server-v0.1.1) (2026-03-26)

### Features

- add `supabaseOptions` and refactor client creation to options objects ([#19](https://github.com/supabase/server/issues/19)) ([5a10099](https://github.com/supabase/server/commit/5a100995a1b6254f92768c82c74b1c754c29b3b2))
- implement server-side DX primitives, wrappers, and adapters ([#6](https://github.com/supabase/server/issues/6)) ([d206e5c](https://github.com/supabase/server/commit/d206e5cdb102bf96e0c501b72e7f161cbf9fba0c))
- passing down Database generic type to `createClient` ([#16](https://github.com/supabase/server/issues/16)) ([4053f6d](https://github.com/supabase/server/commit/4053f6d8db89201a239190a025b08cf19083acb4))
- set initial release version ([8352bda](https://github.com/supabase/server/commit/8352bda35c5967a6692f0a21744d30793e10709a))
- standardize error response ([#18](https://github.com/supabase/server/issues/18)) ([a7ddb74](https://github.com/supabase/server/commit/a7ddb74bfbbe4565d461be7df7f01e64854f6c06))

### Bug Fixes

- key name resolution for client creation ([#9](https://github.com/supabase/server/issues/9)) ([e17bd4e](https://github.com/supabase/server/commit/e17bd4ecb1c46d0dc1468f363c884090d78ae86a))
- remove provenance until repo is public ([2ebbc71](https://github.com/supabase/server/commit/2ebbc71e214c4bbae62c6af203a039801b5e3d4d))
- removing `core` lib exports from root index ([#17](https://github.com/supabase/server/issues/17)) ([5e53e3c](https://github.com/supabase/server/commit/5e53e3c14fcc7c198f1c0bbec9089b4aedd91473))
- support bare array format for SUPABASE_JWKS ([#8](https://github.com/supabase/server/issues/8)) ([6bd2e4d](https://github.com/supabase/server/commit/6bd2e4dfc1b60ce4cc8a1b59435b87797e1cb017))

## 0.1.0 (2026-03-24)

### Features

- implement server-side DX primitives, wrappers, and adapters
- support bare array format for SUPABASE_JWKS
