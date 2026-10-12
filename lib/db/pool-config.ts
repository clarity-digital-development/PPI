import type { PoolConfig } from 'pg'
import { SUPABASE_ROOT_CA } from './supabase-ca'

// Supabase connections verify against Supabase's root CA (./supabase-ca.ts).
// The URL's sslmode has to go: node-postgres lets connection-string settings
// override the `ssl` option, and it reads sslmode=require as "verify against
// the default trust store", which Supabase's chain fails. `pgbouncer` and
// `supa` are hints for other clients that pg doesn't need. Relative imports
// only, so scripts run with tsx can use it too.
export function poolConfig(url: string | undefined): PoolConfig {
  if (!url) return { connectionString: url }
  const u = new URL(url)
  if (!/\.supabase\.(com|co)$/.test(u.hostname)) return { connectionString: url }
  for (const p of ['sslmode', 'pgbouncer', 'supa']) u.searchParams.delete(p)
  return { connectionString: u.toString(), ssl: { ca: SUPABASE_ROOT_CA } }
}
