---
'@opc/server': minor
'@logact-pub/opc-protocol': patch
'@logact-pub/opc-core': patch
---

Add API contract tests (`apps/server/e2e/contract.test.ts`) that validate HTTP and MQTT payloads against `@logact-pub/opc-protocol` schemas. Add `repository` and `publishConfig` to `@logact-pub/opc-core` and `@logact-pub/opc-protocol` to prepare for npm registry publishing.
