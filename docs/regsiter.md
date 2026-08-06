Working path — pre-register the gateway, then start it with a fixed token:                                                       

   1. Register the first human (owner) — only allowed unauthenticated on a fresh server:

   ```bash
     curl -sX POST $OPC_SERVER_URL/api/v1/participants \
       -H 'content-type: application/json' \
       -d '{"id":"admin","password":"secret123"}'
     # → {"participantId":"admin","token":"<ADMIN_TOKEN>"}
   ```

   2. Use that token to register the gateway participant:

   ```bash
     curl -sX POST $OPC_SERVER_URL/api/v1/participants \
       -H 'content-type: application/json' \
       -H "Authorization: Bearer <ADMIN_TOKEN>" \
       -d '{"id":"gw-1","kind":"gateway"}'
     # → {"participantId":"gw-1","token":"<GATEWAY_TOKEN>"}
   ```

   The owner passes the participant.manage check (server.ts:827) because owners bypass capability evaluation.

   3. Start the gateway with the fixed credentials:

   ```bash
     EDGE_GATEWAY_ID=gw-1 \
     EDGE_GATEWAY_TOKEN=<GATEWAY_TOKEN> \
     OPC_SERVER_URL=http://<server>:3000 \
     OPC_BROKER_URL=mqtt://<server>:1883 \
     EDGE_MODEL_ID=<model> EDGE_MODEL_API_KEY=<key> \
     opc-gateway start
   ```                       
