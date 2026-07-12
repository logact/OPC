import { createServer } from './server.js';
import { createDbClient } from '@opc/database';

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/opc';

const db = createDbClient(DATABASE_URL);
const server = createServer({ db });

server.listen(PORT, () => {
  console.log(`OPC server listening on http://localhost:${PORT}`);
});
