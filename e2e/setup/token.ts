import { createClient } from '@supabase/supabase-js'

/** A signed-in test user with a real GoTrue-issued access token. */
export interface TestUser {
  id: string
  email: string
  token: string
}

/**
 * Signs in a test user against the local auth API and returns a real JWT.
 * Creates the user on first run (email confirmations are disabled in
 * e2e/supabase/config.toml, so signUp yields a session immediately).
 */
export async function signInTestUser(
  email: string,
  password: string,
): Promise<TestUser> {
  const url = process.env.SUPABASE_URL
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !anonKey) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_ANON_KEY are not set — run `pnpm gen:env` first.',
    )
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  })

  let { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error) {
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    })
    if (signUpError) {
      throw new Error(
        `could not create test user ${email}: ${signUpError.message}`,
      )
    }
    ;({ data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    }))
  }

  if (error || !data.session || !data.user) {
    throw new Error(
      `could not sign in test user ${email}: ${error?.message ?? 'no session returned'}`,
    )
  }

  return { id: data.user.id, email, token: data.session.access_token }
}
