import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { attachDatabasePool } from '@vercel/functions'
import { poolConfig } from '@/lib/db/pool-config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // Each Vercel instance gets its own pool, so keep it small and let idle
  // connections go quickly; attachDatabasePool closes idle ones before the
  // instance is suspended instead of leaving them open on the database.
  const pool = new Pool({ ...poolConfig(process.env.DATABASE_URL), max: 5, idleTimeoutMillis: 5_000 })
  attachDatabasePool(pool)
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
