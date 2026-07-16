---
'@opc/server': patch
---

Serve the Scalar API reference JavaScript bundle from a local endpoint (`/scalar/api-reference.js`) instead of loading it from the jsdelivr CDN, so the `/docs` page works in environments where the CDN is blocked or slow.
