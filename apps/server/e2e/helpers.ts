import type { Server } from 'node:http';
import { createDbClient, runMigrations } from '@opc/database';
import { createServer } from '../src/server.js';

export interface TestServer {
  baseUrl: string;
  server: Server;
  cleanup: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://opc:opc@localhost:5432/opc';
  const db = createDbClient(databaseUrl);
  await runMigrations(db);

  const server = createServer({ db });
  const port = await getAvailablePort();

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve()).on('error', reject);
  });

  const baseUrl = `http://localhost:${port}`;

  return {
    baseUrl,
    server,
    cleanup: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      // Close pg pool
      await db.$client.end();
    },
  };
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    import('node:net')
      .then(({ createServer }) => {
        const srv = createServer();
        srv.listen(0, '127.0.0.1', () => {
          const address = srv.address();
          const port = address && typeof address === 'object' ? address.port : 0;
          srv.close(() => resolve(port));
        });
        srv.on('error', reject);
      })
      .catch(reject);
  });
}
