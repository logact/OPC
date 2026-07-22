import EncryptedStorage from 'react-native-encrypted-storage';
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

  it('falls back to AsyncStorage when the Keychain is unavailable', async () => {
    await clearCredentials();
    jest
      .spyOn(EncryptedStorage, 'setItem')
      .mockImplementationOnce(() => Promise.reject(new Error('errSecMissingEntitlement')));

    await saveCredentials({
      participantId: 'bob',
      token: 'secret',
      clientId: 'bob-mobile',
    });

    // reads must find the fallback copy (iOS 26 simulator scenario)
    const credentials = await loadCredentials();
    expect(credentials).toEqual({
      participantId: 'bob',
      token: 'secret',
      clientId: 'bob-mobile',
    });

    await clearCredentials();
    expect(await loadCredentials()).toBeNull();
  });
});
