import Constants from 'expo-constants';

// 注意优先级：extra（构建期经 app.json / EXConstants 嵌入）必须优先于
// process.env.EXPO_PUBLIC_*。dev 构建加载 Hermes 字节码 bundle 时，Expo CLI
// 的 EXPO_PUBLIC_* 运行时注入不会执行（process.env 为空）；CI 通过
// ci-mobile-e2e.yml 的 "Inject test server config" 步骤写入 extra。
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
    // RN 端 mqtt.js 只有 WebSocket 传输；broker 在 9001 提供 WS 监听
    'ws://localhost:9001',
} as const;
