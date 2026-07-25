import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENV } from '../config/env';

const STORAGE_KEY = 'opc_server_config';

export interface ServerConfig {
  serverBaseUrl: string;
  mqttBrokerUrl: string;
}

interface ServerConfigState extends ServerConfig {
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  save: (config: ServerConfig) => Promise<void>;
}

export const useServerConfigStore = create<ServerConfigState>((set, get) => ({
  serverBaseUrl: ENV.serverBaseUrl,
  mqttBrokerUrl: ENV.mqttBrokerUrl,
  isHydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ServerConfig>;
        set({
          serverBaseUrl: saved.serverBaseUrl ?? ENV.serverBaseUrl,
          mqttBrokerUrl: saved.mqttBrokerUrl ?? ENV.mqttBrokerUrl,
          isHydrated: true,
        });
        return;
      }
    } catch {
      // fall through to defaults
    }
    set({ isHydrated: true });
  },

  save: async (config: ServerConfig) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    set({ serverBaseUrl: config.serverBaseUrl, mqttBrokerUrl: config.mqttBrokerUrl });
  },
}));
