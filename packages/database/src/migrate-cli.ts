import { createDbClient } from './client/index.js';
import { runMigrations } from './migrate.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const db = createDbClient(DATABASE_URL);

runMigrations(db)
  .then(() => {
    console.log('Migrations completed successfully');
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
