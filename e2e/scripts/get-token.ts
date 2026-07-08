// Signs in a test user against the local stack and prints a real JWT to
// stdout, so it's pipeable:
//
//   TOKEN=$(node e2e/scripts/get-token.ts)
//   curl localhost:8791/me -H "Authorization: Bearer $TOKEN"
//
// Usage: node e2e/scripts/get-token.ts [email] [password]
// Requires Node 22.18+ (type stripping) and a generated e2e/.env.
import { loadEnv } from '../setup/load-env.ts'
import { signInTestUser } from '../setup/token.ts'

loadEnv()

const email = process.argv[2] ?? 'e2e-user-1@example.com'
const password = process.argv[3] ?? 'password-user-1'

const { token } = await signInTestUser(email, password)
console.log(token)
