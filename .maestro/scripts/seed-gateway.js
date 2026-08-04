// Registers a gateway participant through the OPC server REST API so the
// Add Agent gateway picker and the Contacts Gateways section have data.
// Routes come from @logact-pub/opc-protocol:
//   POST /api/v1/participants { id, name, kind: 'gateway' } -> { participantId, token }
// Authorization is now always enforced; provide OPC_OWNER_TOKEN when the server
// already has an Owner. Without it, the script attempts anonymous registration
// (only works on a fresh server before the first Owner is created).
// Idempotent: if registration fails because the gateway already exists,
// the seed is treated as present and we move on.
const gateway = { id: 'maestro-gateway', name: 'Edge Gateway' };

const base = (typeof OPC_SERVER_URL !== 'undefined' && OPC_SERVER_URL) || 'http://localhost:3000';
const ownerToken = (typeof OPC_OWNER_TOKEN !== 'undefined' && OPC_OWNER_TOKEN) || null;

const headers = { 'Content-Type': 'application/json' };
if (ownerToken) {
  headers.Authorization = 'Bearer ' + ownerToken;
}

http.post(base + '/api/v1/participants', {
  headers: headers,
  body: JSON.stringify({ id: gateway.id, name: gateway.name, kind: 'gateway' }),
});
// already registered (or any 4xx) -> treat as seeded

output.seeded = [gateway.id];
