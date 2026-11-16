// Force-resets the root admin password directly in Neon Auth.
// Usage (from the Findam-Website folder):
//   node scripts/reset-root-password.mjs "YourNewPassword"
// Reads ROOT_ADMIN_EMAIL and DATABASE_URL from .env.api. Revokes the account's old sessions.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { neon } from '@neondatabase/serverless'

const newPassword = process.argv[2]
if (!newPassword || newPassword.length < 12) {
  console.error('Give a new password of at least 12 characters: node scripts/reset-root-password.mjs "YourNewPassword"')
  process.exit(1)
}
const require = createRequire(import.meta.url)
const { hashPassword, verifyPassword } = await import(pathToFileURL(require.resolve('better-auth/crypto')).href)

function load(file) {
  const map = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, ''))
  }
  return map
}
const env = load('.env.api')
const rootEmail = String(env.get('ROOT_ADMIN_EMAIL') || '').trim().toLowerCase()
const sql = neon(env.get('DATABASE_URL'), { fetchOptions: { signal: AbortSignal.timeout(30000) } })

const users = await sql`SELECT id, email FROM neon_auth."user" WHERE lower(email) = ${rootEmail}`
if (!users[0]) {
  console.error('No Neon Auth user found for', rootEmail)
  process.exit(1)
}
const userId = users[0].id

const hash = await hashPassword(newPassword)
const updated = await sql`
  UPDATE neon_auth.account SET password = ${hash}, "updatedAt" = now()
  WHERE "userId" = ${userId} AND "providerId" = 'credential'
  RETURNING id
`
console.log('credential rows updated:', updated.length)

const check = await sql`SELECT password FROM neon_auth.account WHERE "userId" = ${userId} AND "providerId" = 'credential'`
console.log('stored hash verifies with the new password:', await verifyPassword({ hash: check[0].password, password: newPassword }))

const sessions = await sql`DELETE FROM neon_auth.session WHERE "userId" = ${userId} RETURNING id`
console.log('old sessions revoked:', sessions.length)
console.log('Done. Sign in at https://usefindam.com/account as', rootEmail)
