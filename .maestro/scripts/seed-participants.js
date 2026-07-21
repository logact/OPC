// Registers seed participants through the OPC server REST API.
// Routes come from @logact-pub/opc-protocol:
//   POST  /api/v1/participants      { id, name }        -> { participantId, token } (public)
//   PATCH /api/v1/participants/:id  { kind: 'agent' }   (Bearer token required)
// Idempotent: if registration fails because the participant already exists,
// the seed is treated as present and we move on.
const seeds = [
  { id: 'maestro-alice', name: 'Alice', kind: 'human' },
  { id: 'maestro-ben', name: 'Ben', kind: 'human' },
  { id: 'maestro-codebot', name: 'Code Bot', kind: 'agent' },
];

const base = (typeof OPC_SERVER_URL !== 'undefined' && OPC_SERVER_URL) || 'http://localhost:3000';

function postParticipant(p) {
  const res = http.post(base + '/api/v1/participants', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: p.id, name: p.name }),
  });
  if (res.status >= 200 && res.status < 300) {
    return JSON.parse(res.body).token;
  }
  // already registered (or any 4xx) -> treat as seeded, no token available
  return null;
}

function patchKind(p, token) {
  if (!token || p.kind !== 'agent') return;
  if (typeof http.request !== 'function') return; // older Maestro: no generic verb support
  http.request(base + '/api/v1/participants/' + encodeURIComponent(p.id), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ kind: 'agent' }),
  });
}

seeds.forEach(function (p) {
  patchKind(p, postParticipant(p));
});

output.seeded = seeds.map(function (p) { return p.id; });
