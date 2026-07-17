import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

export const ENV = {
  serverBaseUrl:
    extra.OPC_SERVER_BASE_URL ??
    process.env.EXPO_PUBLIC_OPC_SERVER_BASE_URL ??
    'http://localhost:3000',
  apiVersion:
    extra.OPC_API_VERSION ??
    process.env.EXPO_PUBLIC_OPC_API_VERSION ??
    'v1',
  mqttBrokerUrl:
    extra.OPC_MQTT_BROKER_URL ??
    process.env.EXPO_PUBLIC_OPC_MQTT_BROKER_URL ??
    'mqtt://localhost:1883',
} as const;
