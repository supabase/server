import { serve } from 'srvx'

/**
 * Serves a Web-standard fetch handler over a real `node:http` server.
 * Used for the Hono, H3, and Elysia apps — Elysia in particular is Bun-first,
 * but its `app.handle` is a plain fetch handler, so wrapping it behind a Node
 * server means CI does not need Bun installed.
 *
 * @returns An async function that stops the server.
 */
export async function startFetchServer(
  fetchHandler: (req: Request) => Response | Promise<Response>,
  port: number,
): Promise<() => Promise<void>> {
  const server = serve({ fetch: fetchHandler, port })
  await server.ready()
  return async () => {
    await server.close()
  }
}
