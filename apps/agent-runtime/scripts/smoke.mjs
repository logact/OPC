/**
 * Agent runtime 端到端冒烟脚本。
 * 前提：OPC server（:3000）与 mosquitto（:1883）可达（本地或经 SSH 隧道转发到 localhost）。
 *
 * 流程：注册人类用户 → 建房 →  spawn 真实 agent-runtime（2 个 shell agent）
 *      → 用户发 "@<agent2> echo ..." → 断言 agent2 回帖且 agent1 不响应。
 *
 * 运行：node apps/agent-runtime/scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpcClient, OpcHttpClient } from '../../../packages/sdk/dist/index.js';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const BROKER_URL = process.env.SMOKE_BROKER_URL ?? 'mqtt://localhost:1883';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 90_000);

const runtimeDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const suffix = Date.now().toString(36);
const userId = `smoke-user-${suffix}`;
// 默认两个 shell agent；可用 SMOKE_AGENTS 覆盖 engine（id 中的 {suffix} 会被替换），
// 例如：SMOKE_AGENTS='[{"id":"smoke-kimi-{suffix}","engine":"kimi"},{"id":"smoke-sh-{suffix}","engine":"shell"}]'
const agentDefs = JSON.parse(
  (process.env.SMOKE_AGENTS ??
    '[{"id":"smoke-a1-{suffix}","engine":"shell","name":"Smoke Agent 1"},{"id":"smoke-a2-{suffix}","engine":"shell","name":"Smoke Agent 2"}]'
  ).replaceAll('{suffix}', suffix),
);
const agent1 = agentDefs[0].id;
const agent2 = agentDefs[1].id;
const password = `pw-${suffix}`;

const log = (...args) => console.log('[smoke]', ...args);
const fail = (msg) => {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exitCode = 1;
};

let runtime;
try {
  // 1. 注册人类用户并建房（用户须在房间内才能订阅 events / 发 uplink）
  const http = new OpcHttpClient(BASE_URL);
  await http.registerParticipant(userId, 'Smoke User', password);
  const { accessToken } = await http.login(userId, password);
  http.setAccessToken(accessToken);
  const { roomId } = await http.createRoom({ name: `agent-runtime-smoke-${suffix}`, participantIds: [userId] });
  log(`room created: ${roomId}`);

  // 2. spawn 真实 runtime 进程
  const env = {
    ...process.env,
    OPC_BASE_URL: BASE_URL,
    OPC_BROKER_URL: BROKER_URL,
    OPC_ROOM_ID: roomId,
    OPC_AGENTS: JSON.stringify(agentDefs),
    OPC_DEFAULT_AGENT: agent1,
    OPC_DATA_DIR: join(runtimeDir, 'data', `smoke-${suffix}`),
  };
  runtime = spawn('node', [join(runtimeDir, 'dist', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  runtime.stdout.on('data', (d) => process.stdout.write(`[runtime] ${d}`));
  runtime.stderr.on('data', (d) => process.stdout.write(`[runtime:err] ${d}`));
  runtime.on('exit', (code) => log(`runtime exited with code ${code}`));

  // 等两个 agent 上线（日志出现 online）
  let runtimeLog = '';
  runtime.stdout.on('data', (d) => (runtimeLog += d.toString()));
  const deadline = Date.now() + TIMEOUT_MS;
  while (!runtimeLog.includes(`[${agent2}] online`)) {
    if (Date.now() > deadline) throw new Error('runtime agents did not come online in time');
    if (runtime.exitCode !== null) throw new Error(`runtime exited early with code ${runtime.exitCode}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  log('runtime online');

  // 3. 用户接入房间，监听回帖（注册时返回的 token 即 MQTT 密码，只发一次，需当场接住）
  const user2Id = `smoke-user2-${suffix}`;
  const { token: user2Token } = await http.registerParticipant(user2Id, 'Smoke User 2', password);
  await http.addRoomMembers(roomId, { participantIds: [user2Id] });
  const user = new OpcClient({ baseUrl: BASE_URL, brokerUrl: BROKER_URL, participantId: user2Id, token: user2Token, accessToken });
  await user.connect();
  await user.subscribeRoom(roomId);
  log(`user ${user2Id} subscribed`);

  const replies = [];
  user.events.on('message.delivered', (e) => {
    const m = e.message;
    if (m.from !== user2Id) replies.push(m);
  });

  // 4. 发任务：定向给 agent2（任务/断言可用 SMOKE_TASK / SMOKE_EXPECT 覆盖，{suffix} 会替换）
  const marker = process.env.SMOKE_EXPECT?.replaceAll('{suffix}', suffix) ?? `hello-from-smoke-${suffix}`;
  const task = process.env.SMOKE_TASK?.replaceAll('{suffix}', suffix) ?? `echo ${marker}`;
  await user.sendText(roomId, `@${agent2} ${task}`);
  log(`task sent: @${agent2} ${task}`);

  // 5. 断言：agent2 回复包含期望文本；等一段时间确认 agent1 不响应
  while (!replies.some((m) => m.from === agent2 && m.content.body.includes(marker))) {
    if (Date.now() > deadline) throw new Error(`no reply from ${agent2}; got: ${JSON.stringify(replies.map((m) => m.from))}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  log('agent2 replied with expected content ✓');

  await new Promise((r) => setTimeout(r, 3000));
  const a1Replies = replies.filter((m) => m.from === agent1);
  if (a1Replies.length > 0) {
    fail(`${agent1} should not have replied to @${agent2} mention, got: ${JSON.stringify(a1Replies.map((m) => m.content.body))}`);
  } else {
    log('agent1 stayed silent ✓');
  }

  // 6. 再发一条无提及消息 → 应路由到 default agent1
  const marker2 = `default-route-${suffix}`;
  await user.sendText(roomId, `echo ${marker2}`);
  const deadline2 = Date.now() + TIMEOUT_MS;
  while (!replies.some((m) => m.from === agent1 && m.content.body.includes(marker2))) {
    if (Date.now() > deadline2) throw new Error('default route to agent1 failed');
    await new Promise((r) => setTimeout(r, 300));
  }
  log('unmentioned message routed to default agent1 ✓');

  await user.disconnect();
  if (!process.exitCode) log('PASS');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  runtime?.kill('SIGTERM');
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}
