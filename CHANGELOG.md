# Changelog

## [0.1.3](https://github.com/supabase/server/compare/server-v0.1.2...server-v0.1.3) (2026-04-01)


### Bug Fixes

* move SKILL.md into skills/ subdirectory to align with agentskills spec ([#24](https://github.com/supabase/server/issues/24)) ([10c8780](https://github.com/supabase/server/commit/10c8780cc21de3bb860d2ec8bf5589f69d4ea447))

## [0.1.2](https://github.com/supabase/server/compare/server-v0.1.1...server-v0.1.2) (2026-04-01)


### Features

* exposing `keyName` to `SupabaseContext` ([#22](https://github.com/supabase/server/issues/22)) ([7f1b1a7](https://github.com/supabase/server/commit/7f1b1a75cc98d08a63275131481e5df825c10afb))

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
