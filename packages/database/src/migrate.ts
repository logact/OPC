import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { DbClient } from './client/index.js';

export async function runMigrations(db: DbClient): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
}
