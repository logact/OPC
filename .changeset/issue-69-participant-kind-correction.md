---
'@opc/database': patch
---

修复 participant 重复注册不纠正 kind 的问题（#69）：已落库为 human 的 participant（房间 ensure 自动补建或缺省 kind 注册）可通过显式 kind 的重复注册升级为 gateway/agent；非 human 的 kind 保持粘性，缺省 kind 的 token 轮换不会降级。
