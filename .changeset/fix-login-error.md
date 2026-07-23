---
'@opc/mobile': patch
'@opc/api-client': patch
---

fix login error

- add `adapter: 'fetch'` to axios for iOS compatibility with FRP proxy
- add request interceptor for Authorization header
- embed server URLs in app.json extra for native builds
