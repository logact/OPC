// Registers a gateway participant through the OPC server REST API so the
// Add Agent gateway picker and the Contacts Gateways section have data.
// Routes come from @logact-pub/opc-protocol:
//   POST /api/v1/participants { id, name, kind: 'gateway' } -> { participantId, token } (public)
// Idempotent: if registration fails because the participant already exists,
// the seed is treated as present and we move on.
const gateway = { id: 'maestro-gateway', name: 'Edge Gateway' };

const base = (typeof OPC_SERVER_URL !== 'undefined' && OPC_SERVER_URL) || 'http://localhost:3000';

http.post(base + '/api/v1/participants', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: gateway.id, name: gateway.name, kind: 'gateway' }),
});
// already registered (or any 4xx) -> treat as seeded

output.seeded = [gateway.id];
