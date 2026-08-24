/**
 * A query reduced to the two things `pg` needs: parameterized SQL text, and
 * the values its placeholders refer to.
 *
 * @category Middleware
 */
export interface CompiledQuery {
  /** SQL text with `$1`-style placeholders in place of every interpolation. */
  text: string
  /** Interpolated values, in placeholder order. */
  values: unknown[]
}

/**
 * Compile a tagged template into parameterized SQL.
 *
 * Every interpolation becomes a numbered placeholder and its value moves into
 * `values` — so an interpolated string is never SQL text and cannot change the
 * shape of the statement, no matter what it holds. This is what makes the
 * `query` tag safe by construction.
 *
 * Values are not deduplicated: two interpolations of the same value get two
 * placeholders. Postgres plans them identically, and matching placeholders to
 * interpolations one-for-one keeps the compiled text readable next to its
 * source.
 *
 * @internal
 */
export function compileTemplate(
  strings: TemplateStringsArray,
  values: unknown[],
): CompiledQuery {
  // `query('select 1')` and `query`select 1`` differ only in their brackets.
  // Without this the string's first character would be read as the whole
  // template and a one-character query would be sent, so refuse loudly.
  if (!Array.isArray(strings) || !('raw' in strings)) {
    throw new TypeError(
      'query() takes a tagged template, not a string — write query`select ...` ' +
        'with backticks so interpolations become bind parameters. To run SQL ' +
        'text built elsewhere, use queryRaw(text, params).',
    )
  }

  let text = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}${strings[i + 1] ?? ''}`
  }
  return { text, values }
}

/**
 * Quote a Postgres identifier — a table, column, or role name — for safe
 * interpolation into SQL text.
 *
 * Bind parameters cover *values* and nothing else: `order by $1` sorts every
 * row by the constant string `$1`, and `select $1 from t` selects a literal,
 * not a column. Identifiers therefore have to reach the server as SQL text,
 * which is the one place string-building is unavoidable. This makes that step
 * safe by quoting the name and doubling any embedded quote, so the result is
 * always exactly one identifier no matter what it contains.
 *
 * **It is not an allowlist.** Quoting a caller-supplied name yields a valid
 * identifier, not a permitted one — `ident(req.query.sort)` cannot inject SQL
 * but can still read a column the caller was never meant to see. Check the
 * name against a fixed set you control first, then quote it.
 *
 * @example
 * ```ts
 * const SORTABLE = new Set(['created_at', 'title'])
 * if (!SORTABLE.has(column)) throw new Error('unsupported sort column')
 * const rows = await ctx.postgres.queryRaw(
 *   `select id, title from posts order by ${ident(column)} desc`,
 * )
 * ```
 *
 * @param name - The identifier to quote.
 * @returns The name wrapped in double quotes, with embedded quotes doubled.
 * @throws If `name` is empty or contains a NUL byte — neither can survive the
 * round trip, and Postgres reports both with errors that do not name the cause.
 *
 * @category Middleware
 */
export function ident(name: string): string {
  if (name === '') {
    throw new Error('ident() received an empty identifier')
  }
  if (name.includes('\0')) {
    throw new Error('ident() received an identifier containing a NUL byte')
  }
  return `"${name.replace(/"/g, '""')}"`
}
