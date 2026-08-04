// Registers seed participants through the OPC server REST API.
// Routes come from @logact-pub/opc-protocol:
//   POST  /api/v1/participants      { id, name, kind }  -> { participantId, token }
// Authorization is now always enforced. If OPC_OWNER_TOKEN is provided,
// registrations are performed as the Owner with the desired kind directly.
// Without it, the script falls back to anonymous registration and PATCH to
// agent kind (only works on a fresh server with no Owner yet).
// Idempotent: if registration fails because the participant already exists,
// the seed is treated as present and we move on.
const seeds = [
  { id: 'maestro-alice', name: 'Alice', kind: 'human' },
  { id: 'maestro-ben', name: 'Ben', kind: 'human' },
  { id: 'maestro-codebot', name: 'Code Bot', kind: 'agent' },
];

const base = (typeof OPC_SERVER_URL !== 'undefined' && OPC_SERVER_URL) || 'http://localhost:3000';
const ownerToken = (typeof OPC_OWNER_TOKEN !== 'undefined' && OPC_OWNER_TOKEN) || null;

function baseHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (ownerToken) {
    headers.Authorization = 'Bearer ' + ownerToken;
  }
  return headers;
}

function postParticipant(p) {
  const payload = ownerToken
    ? { id: p.id, name: p.name, kind: p.kind }
    : { id: p.id, name: p.name };
  const res = http.post(base + '/api/v1/participants', {
    headers: baseHeaders(),
    body: JSON.stringify(payload),
  });
  if (res.status >= 200 && res.status < 300) {
    return ownerToken ? ownerToken : (JSON.parse(res.body).token || null);
  }
  // already registered (or any 4xx) -> treat as seeded, no token available
  return null;
}

function patchKind(p, token) {
  if (ownerToken || !token || p.kind !== 'agent') return;
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
