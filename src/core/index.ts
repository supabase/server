/**
 * Composable primitives for constructing a {@link SupabaseContext}.
 *
 * These are the Layer 2 building blocks that {@link withSupabase} and
 * {@link createSupabaseContext} are built on. Use them when you need
 * fine-grained control over individual steps of the context creation pipeline.
 *
 * **Pipeline order:**
 * 1. {@link resolveEnv} — Read env vars into a {@link SupabaseEnv}
 * 2. {@link extractCredentials} — Pull token + apikey from request headers
 * 3. {@link verifyCredentials} — Validate credentials against allowed auth modes
 * 4. {@link createContextClient} / {@link createAdminClient} — Build Supabase clients
 *
 * Or use {@link verifyAuth} to combine steps 2–3 in a single call.
 *
 * @packageDocumentation
 */

export { resolveEnv } from './resolve-env.js'
export { extractCredentials } from './extract-credentials.js'
export { verifyCredentials } from './verify-credentials.js'
export { verifyAuth } from './verify-auth.js'
export { createContextClient } from './create-context-client.js'
export { createAdminClient } from './create-admin-client.js'
