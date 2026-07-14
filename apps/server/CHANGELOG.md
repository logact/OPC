# @opc/server

## 1.0.0

### Major Changes

- 2d29995: 架构改造：实时通讯从 WebSocket 迁移到 MQTT（Mosquitto broker，客户端直连）。server 订阅上行 topic 校验落库后向房间 events topic 转发事件；参与者注册发放 token，broker 经 mosquitto-go-auth HTTP 回调 server 完成认证与房间成员级 ACL。WebSocket 链路完全移除。

## 1.0.0-rc.0

### Major Changes

- 2d29995: 架构改造：实时通讯从 WebSocket 迁移到 MQTT（Mosquitto broker，客户端直连）。server 订阅上行 topic 校验落库后向房间 events topic 转发事件；参与者注册发放 token，broker 经 mosquitto-go-auth HTTP 回调 server 完成认证与房间成员级 ACL。WebSocket 链路完全移除。
