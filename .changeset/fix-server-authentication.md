---
'@opc/mobile': patch
'@opc/server': patch
'@opc/api-client': patch
'@opc/database': patch
---

fix server authentication error

- server: add debug logging for token lookup
- database: improve findByToken query logging
- api-client: remove redundant adapter config
- mobile: simplify auth store and HTTP client setup
