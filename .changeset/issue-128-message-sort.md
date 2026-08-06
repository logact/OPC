---
'@opc/mobile': patch
---

fix(mobile): show latest chat message at the bottom (issue #128)

The room history API returns messages newest-first, but `roomStore.enterRoom` stored them as-is, so the chat page rendered the newest message at the top. History is now reversed to oldest-first on room entry, so the message list reads top-to-bottom like a normal IM app and live messages keep appending at the bottom. No protocol/server changes.
