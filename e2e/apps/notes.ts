import type { SupabaseClient } from '@supabase/supabase-js'

/** Row shape of the e2e `notes` table (see e2e/supabase/migrations). */
export interface NoteRow {
  id: string
  user_id: string
  body: string
}

const COLUMNS = 'id, user_id, body'

/** Inserts a note via the admin client, scoped to the calling user's id. */
export async function insertNote(
  supabaseAdmin: SupabaseClient,
  userId: string,
  body: string,
): Promise<NoteRow> {
  const { data, error } = await supabaseAdmin
    .from('notes')
    .insert({ user_id: userId, body })
    .select(COLUMNS)
    .single()
  if (error) throw new Error(`insert note failed: ${error.message}`)
  return data as NoteRow
}

/**
 * Lists ALL notes through the admin client — every user's rows. Proves the
 * admin client is not scoped to the caller's identity and bypasses RLS.
 */
export async function listAllNotes(
  supabaseAdmin: SupabaseClient,
): Promise<NoteRow[]> {
  const { data, error } = await supabaseAdmin
    .from('notes')
    .select(COLUMNS)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`list all notes failed: ${error.message}`)
  return data as unknown as NoteRow[]
}

/**
 * Lists notes through the user-scoped client — no WHERE clause. The caller's
 * JWT travels to PostgREST and the RLS policy alone scopes the rows.
 */
export async function listOwnNotes(
  supabase: SupabaseClient,
): Promise<NoteRow[]> {
  const { data, error } = await supabase
    .from('notes')
    .select(COLUMNS)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`list own notes failed: ${error.message}`)
  return data as unknown as NoteRow[]
}

/** Lists only the calling user's notes. */
export async function listNotes(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<NoteRow[]> {
  const { data, error } = await supabaseAdmin
    .from('notes')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`list notes failed: ${error.message}`)
  return data as unknown as NoteRow[]
}
