import { env } from '@/lib/env'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
// import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

const pool = new Pool({ connectionString: env.DATABASE_URL })
// export const db = env.NODE_ENV === 'production' ? drizzle({ client: pool }) : drizzlePg('postgresql://postgres:root@localhost:5435')
export const db = drizzle({ client: pool })

export type Database = typeof db
