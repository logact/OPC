/**
 * OPC MQTT topic 约定。
 * 唯一事实来源在 `@logact-pub/opc-protocol`（含 issue #108 的 reads topic），
 * 此处仅 re-export 以保持既有 import 路径不变。
 */
export {
  MQTT_TOPICS,
  parseUplinkTopic,
  parseReadsTopic,
  parseRoomTopic,
  type RoomTopic,
  type RoomTopicDirection,
} from '@logact-pub/opc-protocol';
