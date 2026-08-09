// Creates the deterministic direct room used by the issue #96 unread-badge
// journey. It runs before the app launches so the mobile client learns the
// room and subscribes to its events during its initial room-list load.
const base = (typeof OPC_SERVER_URL !== 'undefined' && OPC_SERVER_URL) || 'http://localhost:3000';
const ownerToken = (typeof OPC_OWNER_TOKEN !== 'undefined' && OPC_OWNER_TOKEN) || '';

if (!ownerToken) {
  throw new Error('OPC_OWNER_TOKEN is required to seed the unread-message journey.');
}

const response = http.post(base + '/api/v1/rooms/direct', {
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + ownerToken,
  },
  body: JSON.stringify({ participantIds: ['maestro-e2e', 'maestro-alice'] }),
});

if (response.status < 200 || response.status >= 300) {
  throw new Error('Creating unread test room failed (' + response.status + '): ' + response.body);
}

output.unreadRoomId = JSON.parse(response.body).roomId;
