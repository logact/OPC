# @opc/protocol

## 0.0.2

### Patch Changes

- 1c9eb79: 修复 mosquitto-go-auth HTTP 后端回调的 schema：superuser 回调仅发送 username，拆分为独立的 MqttAuthSuperuserRequestSchema；MQTT ACL/user/superuser 回调中的 clientid 允许 null；parseRoomTopic 支持 opc/rooms/+/uplink 通配 topic。
