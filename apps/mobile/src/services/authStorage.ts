import EncryptedStorage from 'react-native-encrypted-storage';

const CREDENTIALS_KEY = 'opc_credentials';

export interface StoredCredentials {
  participantId: string;
  token: string;
  clientId: string;
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await EncryptedStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  await EncryptedStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export async function clearCredentials(): Promise<void> {
  await EncryptedStorage.removeItem(CREDENTIALS_KEY);
}
