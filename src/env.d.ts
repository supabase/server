/* eslint-disable no-var */

declare var Deno:
  | {
      env: {
        get(key: string): string | undefined
      }
    }
  | undefined

declare var process:
  | {
      env: Record<string, string | undefined>
    }
  | undefined
