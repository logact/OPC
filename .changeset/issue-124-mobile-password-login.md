---
'@opc/mobile': minor
'@opc/api-client': minor
'@opc/server': minor
---

feat(mobile): password login on LoginScreen (issue #124)

- `@opc/api-client`: new `createAuthApi` with `login(username, password)` → `POST /api/v1/auth/login`, response validated at runtime with `LoginResponseSchema`.
- `@opc/mobile`: `LoginScreen` now logs in with participant ID + password and stores the returned JWT via the existing `saveCredentials` / `setAuthToken` path; first-human registration remains as a fallback mode for fresh servers (401 from register surfaces "server already initialized, please log in"). Stored-credential hydration is unchanged.
- `@opc/server`: the mosquitto-go-auth user callback now also accepts a `/auth/login` JWT whose `sub` matches the MQTT username (password login leaves mobile holding only a JWT, no participant token). Participant tokens keep working. Backward compatible.

All changes are backward-compatible additions; no protocol schema/route changes.
