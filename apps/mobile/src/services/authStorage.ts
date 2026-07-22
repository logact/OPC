import EncryptedStorage from 'react-native-encrypted-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CREDENTIALS_KEY = 'opc_credentials';

export interface StoredCredentials {
  participantId: string;
  token: string;
  clientId: string;
}

// iOS 26 simulators deny Keychain access to unsigned builds
// (errSecMissingEntitlement -34018), so every Keychain call can fail there.
// Fall back to AsyncStorage to keep the app usable in that environment;
// on real (signed) devices the EncryptedStorage path always succeeds.

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await EncryptedStorage.getItem(CREDENTIALS_KEY);
    if (raw) return JSON.parse(raw) as StoredCredentials;
  } catch {
    // fall through to the AsyncStorage fallback
  }
  try {
    const raw = await AsyncStorage.getItem(CREDENTIALS_KEY);
    return raw ? (JSON.parse(raw) as StoredCredentials) : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  const raw = JSON.stringify(credentials);
  try {
    await EncryptedStorage.setItem(CREDENTIALS_KEY, raw);
    return;
  } catch {
    // fall through to the AsyncStorage fallback
  }
  await AsyncStorage.setItem(CREDENTIALS_KEY, raw);
}

export async function clearCredentials(): Promise<void> {
  try {
    await EncryptedStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    // Keychain unavailable — still clear the fallback copy below
  }
  await AsyncStorage.removeItem(CREDENTIALS_KEY);
}
