/** Protocol is the sole source for MQTT topic contracts. */
export {
  MQTT_TOPICS,
  parseParticipantUplinkTopic,
  parseParticipantReadsTopic,
  parseRoomTopic,
  type ParticipantUplinkTopic,
  type RoomTopic,
  type RoomTopicDirection,
} from '@logact-pub/opc-protocol';
