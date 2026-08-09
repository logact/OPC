// Sends a fresh message as Alice only after the app has subscribed to the
// seeded room. The app is logged in as Maestro E2E, so this must produce an
// unread badge rather than an own-message preview.
const base = (typeof OPC_SERVER_URL !== 'undefined' && OPC_SERVER_URL) || 'http://localhost:3000';
const password =
  (typeof MAESTRO_PASSWORD !== 'undefined' && MAESTRO_PASSWORD) || 'maestro-e2e-password';
const roomId = output.unreadRoomId;

if (!roomId) {
  throw new Error('unreadRoomId is missing; run seed-unread-room.js first.');
}

const login = http.post(base + '/api/v1/auth/login', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'maestro-alice', password: password }),
});
if (login.status < 200 || login.status >= 300) {
  throw new Error('Logging in as unread-message sender failed (' + login.status + '): ' + login.body);
}

const text = 'Unread MQTT message ' + Date.now();
const accessToken = JSON.parse(login.body).accessToken;
const sent = http.post(base + '/api/v1/rooms/' + encodeURIComponent(roomId) + '/broadcast', {
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  },
  body: JSON.stringify({ content: { type: 'text', body: text } }),
});
if (sent.status < 200 || sent.status >= 300) {
  throw new Error('Sending unread test message failed (' + sent.status + '): ' + sent.body);
}

output.unreadMessageText = text;
