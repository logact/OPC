import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
} from '../services/authStorage';

describe('authStorage', () => {
  it('saves and loads credentials', async () => {
    await saveCredentials({
      participantId: 'alice',
      token: 'secret',
      clientId: 'alice-mobile',
    });

    const credentials = await loadCredentials();
    expect(credentials).toEqual({
      participantId: 'alice',
      token: 'secret',
      clientId: 'alice-mobile',
    });
  });

  it('returns null when no credentials are stored', async () => {
    await clearCredentials();
    const credentials = await loadCredentials();
    expect(credentials).toBeNull();
  });
});
