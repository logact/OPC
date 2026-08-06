# Graph Report - .  (2026-08-05)

## Corpus Check
- 376 files · ~164,801 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2509 nodes · 4146 edges · 185 communities (129 shown, 56 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 62 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Task Org API Schemas
- Protocol Schema Definitions
- Server Events Tasks
- Mobile API Client Hooks
- Mobile Build Dependencies
- Mobile Workflow UI
- Agent Gateway Core
- Mobile Navigation Shell
- Repo Tooling Config
- Gateway Admin Server
- Gateway E2E Tests
- API Client Core
- Database Package Config
- Gateway Task Tests
- Task Repository Layer
- Gateway CLI Package
- Server Package Config
- Agent Gateway Package Config
- Tasks E2E Tests
- Agent Edge Package Config
- Database Client Migrations
- Protocol Package Config
- Mobile App Entry
- Gateway Unit Tests
- Maestro E2E Flows
- Agent Runtime Interface
- Expo App Config
- Agent Runtime Core
- Core Package Config
- Authorization E2E Tests
- Fake Agent Test Double
- Organization Repository
- Organization E2E Tests
- Architecture Docs Concepts
- Echo Agent
- API Client Package Config
- Task SDK Tests
- Mobile Runtime Dependencies
- Reply Agent
- Recording Agent
- Agent Edge Types
- Pi Thread Runtime
- Authorization SDK Client
- Fake Agent Fixtures
- Mobile MQTT Client
- MQTT Client Package Config
- Organization Seed Script
- Agent Edge Model Tests
- Database Schema Tables
- Contacts Screen Tests
- Task SDK Client
- Package TSConfig
- Package TSConfig
- Protocol Wire Contracts
- Package TSConfig
- API Client Errors Auth
- Chat Screen Tests
- Pi Transcript Mapping
- Gateway CLI Support
- Server HTTP Assembly
- SDK Package Config
- Gateway Changesets
- Add Agent Catalog Tests
- SDK MQTT Client
- CI Workflows
- Gateway State Store
- Organization API Routes
- Authorization Service
- Owner Bootstrap
- Gateway Model Tests
- iOS App Delegate
- Task List Screen
- Add Agent Screen Tests
- Server MQTT Bridge
- Task HTTP Routes
- Changeset Config
- Admin Client Commands
- Server Unit Tests
- Authorization Changesets
- Gateway CLI Entry
- Android Main Activity
- Room Info Screen Tests
- Task Assignment Tests
- E2E TSConfig
- Edge Runtime Config
- iOS App Config
- Package TSConfig
- Package TSConfig
- Package TSConfig
- Rooms API Routes
- Tasks API Routes
- Package TSConfig
- Package TSConfig
- Package TSConfig
- Android Main Application
- Package TSConfig
- Package TSConfig
- Authorization Audit Store
- Agent Task Execution Tests
- Package TSConfig
- iOS React Native Delegate
- Org Tree Screen Tests
- Admin Data Source
- SDK Native Dependencies
- Agent Mention Workflow Test
- iOS App Dependencies
- Task Actions
- Package TSConfig
- Maestro Fail Fast Script
- Model Catalog Changesets
- Core Architecture Rationale
- Docker Compose Stacks
- Issue Workflow Skill
- Board Status Script
- Edge Logger
- Gateway Registration Tests
- Participants API Routes
- Message Factory
- ACR Deploy Script
- Gateway Control Changesets
- Splash Logo Assets
- Gradle Wrapper Script
- Jest Config
- Metro Config
- Safe Area Mock
- React Native Bootstrap Docs
- Capability Store Tests
- Participant Seed Script
- Vitest Dependencies
- Gate Watch Script
- Cached Packages Metadata
- Async Storage Mock
- Encrypted Storage Mock
- Presence Protocol Changesets
- Changeset Versioning Docs
- Gateway Seed Script
- Breaking Change Process
- Admin Register Script
- Gateway Register Script
- Splash Logo Hdpi
- Splash Logo Xxhdpi
- Splash Logo Xxxhdpi
- Launcher Icon Hdpi
- Round Launcher Xhdpi
- Auth Fix Changesets
- Gateway Admin Changesets
- Task System Changesets
- Offline Catchup Changesets
- Chats Subflow
- Offline Catchup Mechanism
- Agent Presence Model
- Splash Logo Xhdpi
- Round Launcher Hdpi
- Launcher Icon Mdpi
- Round Launcher Mdpi
- Launcher Icon Xhdpi
- Launcher Icon Xxhdpi
- Round Launcher Xxhdpi
- Launcher Icon Xxxhdpi
- Round Launcher Xxxhdpi
- Expo Local State
- iOS App Icon
- Safe Area Provider
- Safe Area View
- Room List Refresh Fix
- Bundle ID Rename
- Agent Mention Workflow
- Pnpm Workspace

## God Nodes (most connected - your core abstractions)
1. `OpcHttpClient` - 60 edges
2. `AgentGateway` - 45 edges
3. `API_ROUTES` - 42 edges
4. `throwHttpError()` - 39 edges
5. `AgentRuntime` - 36 edges
6. `useAuth()` - 31 edges
7. `PiThread` - 28 edges
8. `FutureAuthorizationSdk` - 24 edges
9. `FakeAgent` - 24 edges
10. `FakeAgent` - 24 edges

## Surprising Connections (you probably didn't know these)
- `createTaskRepository()` --indirect_call--> `departmentIsWithin()`  [INFERRED]
  packages/database/src/repositories/tasks.ts → apps/mobile/src/utils/organization.ts
- `uplink → 落库 → events 消息链路` --semantically_similar_to--> `单连接多路复用数据面（issue #80）`  [INFERRED] [semantically similar]
  README.md → AGENTS.md
- `docker-compose.dev.yml 开发栈` --semantically_similar_to--> `docker-compose.staging.yml 预发栈`  [INFERRED] [semantically similar]
  docker-compose.dev.yml → docker-compose.staging.yml
- `docker-compose.prod.yml 生产栈` --semantically_similar_to--> `docker-compose.dev.yml 开发栈`  [INFERRED] [semantically similar]
  docker-compose.prod.yml → docker-compose.dev.yml
- `WebSocket-to-MQTT architecture migration (server 1.0.0)` --semantically_similar_to--> `HTTP control plane + MQTT data plane topology`  [INFERRED] [semantically similar]
  apps/server/CHANGELOG.md → docs/project-main-flows.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **GitHub Issue Workflow skill 套件（router + 4 个 reference 文档）** — agents_skills_github_issue_workflow_skill_router, agents_skills_github_issue_workflow_reference_feat_workflow, agents_skills_github_issue_workflow_reference_bug_workflow, agents_skills_github_issue_workflow_reference_conventions, agents_skills_github_issue_workflow_reference_worker_mode [EXTRACTED 1.00]
- **docker-compose 环境栈（base + dev/prod/staging 变体）** — docker_compose_base_services, docker_compose_dev_services, docker_compose_prod_services, docker_compose_staging_services [INFERRED 0.95]
- **Agent gateway 控制面落地（约定 + protocol changeset + server/sdk changeset）** — agents_gateway_control_plane, changeset_agent_gateway_protocol, changeset_agent_gateway_server_sdk [INFERRED 0.85]
- **Issue #64: gateway discovery and per-agent model config across protocol, server/sdk/api-client, gateway, and mobile** — _changeset_issue_64_gateway_agent_protocol, _changeset_issue_64_gateway_agent_clients, _changeset_issue_64_agent_gateway_model, _changeset_issue_64_mobile_add_agent, _changeset_issue_64_gateway_agent_protocol_agentspawncommand [EXTRACTED 1.00]
- **Issue #70: gateway model catalog reported by gateway, persisted by server, consumed by api-client/mobile** — _changeset_issue_70_model_catalog_protocol, _changeset_issue_70_model_catalog_server, _changeset_issue_70_model_catalog_gateway, _changeset_issue_70_model_catalog_clients, _changeset_issue_70_model_catalog_protocol_gatewaymodelcatalog [EXTRACTED 1.00]
- **Issue #80: gateway single MQTT connection multiplexing all agent traffic (agent events topic, uplink proxy, presence proxy)** — _changeset_issue_80_gateway_multiplex_protocol, _changeset_issue_80_gateway_multiplex_server, _changeset_issue_64_gateway_agent_protocol_agentspawncommand, _changeset_issue_73_agent_gateway_ownership_protocol_gatewayid [EXTRACTED 1.00]
- **Presence Feature (Issue #72)** — changeset_presence_protocol_presenceschema, changeset_presence_sdk_presencereporting, changeset_presence_server_mobile_presenceimpl [EXTRACTED 1.00]
- **Changesets Release Pipeline** — github_workflows_release_releaseprworkflow, github_workflows_tag_release_tagreleaseonmerge, github_workflows_ci_cipipeline, github_workflows_deploy_development_on_release_autodevdeploy, github_workflows_deploy_deploytoenvironment [EXTRACTED 1.00]
- **Shared login-and-seed setup reused across functional flows** — _maestro_subflows_login_login_subflow, _maestro_subflows_login_as_login_as_subflow, _maestro_subflows_seed_seed_subflow, _maestro_flows_04_chat_room_send_f4_chat_room_send, _maestro_flows_11_organization_tree_f12_organization_tree, _maestro_flows_14_task_human_lifecycle_f15_task_human_lifecycle [EXTRACTED 1.00]
- **Flows depending on the seeded maestro-gateway fixture (scripts/seed-gateway.js)** — _maestro_flows_08_contacts_f9_contacts, _maestro_flows_09_add_agent_f6_add_agent, _maestro_flows_11_organization_tree_f12_organization_tree, _maestro_flows_12_organization_management_f13_organization_management, _maestro_flows_13_organization_unauthorized_f14_unauthorized, _maestro_flows_14_task_human_lifecycle_f15_task_human_lifecycle, _maestro_flows_15_task_agent_progress_f16_task_agent_progress [EXTRACTED 1.00]
- **Layered style verification: contract, tokens, and the 90-style suite** — _maestro_readme_testid_contract, _maestro_readme_style_tokens, _maestro_readme_layered_style_coverage, _maestro_flows_90_style_style_suite [EXTRACTED 1.00]
- **Agent message pipeline (spawn -> reply uplink -> offline redelivery)** — docs_project_main_flows_agent_spawn_chain, docs_project_main_flows_agent_reply_uplink_chain, docs_project_main_flows_offline_redelivery [EXTRACTED 1.00]

## Communities (185 total, 56 thin omitted)

### Community 0 - "Task Org API Schemas"
Cohesion: 0.01
Nodes (150): CancelTaskRequestSchema, GetDepartmentResponseSchema, GetPositionResponseSchema, ResumeTaskRequestSchema, TaskMutationResponseSchema, UpdateDepartmentResponseSchema, UpdateOrganizationResponseSchema, UpdatePositionResponseSchema (+142 more)

### Community 1 - "Protocol Schema Definitions"
Cohesion: 0.02
Nodes (94): AddRoomMembersRequestSchema, AddRoomMembersResponseSchema, AgentModelConfigSchema, AgentPresenceStatusSchema, AppendTaskEventRequestSchema, ApproveTaskRequestSchema, AssignTaskRequestSchema, AuthorizationAuditEntrySchema (+86 more)

### Community 2 - "Server Events Tasks"
Cohesion: 0.06
Nodes (15): events, events, API_ROUTES, dependencies, events, @logact-pub/opc-protocol, mqtt, OpcClientOptions (+7 more)

### Community 3 - "Mobile API Client Hooks"
Cohesion: 0.09
Nodes (44): http, participantsApi, roomsApi, useMqtt(), useAuth(), useRoom(), AddAgentScreen(), GatewayRow() (+36 more)

### Community 4 - "Mobile Build Dependencies"
Cohesion: 0.05
Nodes (41): description, devDependencies, @babel/core, @babel/preset-env, babel-preset-expo, @babel/runtime, eas-cli, eslint (+33 more)

### Community 5 - "Mobile Workflow UI"
Cohesion: 0.15
Nodes (33): organizationApi, tasksApi, ActionButton(), Card(), Chip(), EmptyState(), Field(), InlineNotice() (+25 more)

### Community 6 - "Agent Gateway Core"
Cohesion: 0.14
Nodes (6): AgentGateway, isMqttParseError(), TaskExecutionRecord, TaskExecutionState, ServerEventSchema, TaskMessageMetadataSchema

### Community 7 - "Mobile Navigation Shell"
Cohesion: 0.12
Nodes (31): useParticipantPresence(), useRecoverableApiError(), MainTabs(), TODO: replace with a splash/loading screen, Stack, styles, Tab, DepartmentDetailScreen() (+23 more)

### Community 8 - "Repo Tooling Config"
Cohesion: 0.05
Nodes (39): description, devDependencies, @changesets/cli, eslint, @eslint/js, @types/node, typescript, typescript-eslint (+31 more)

### Community 9 - "Gateway Admin Server"
Cohesion: 0.09
Nodes (26): AdminAgentEntry, AdminServerOptions, AdminStatus, AdminThreadEntry, sendError(), sendJson(), startAdminServer(), stopAdminServer() (+18 more)

### Community 10 - "Gateway E2E Tests"
Cohesion: 0.14
Nodes (21): SpawnedAgent, waitFor(), waitForAgentOnline(), CachedOwner, connectSdkClient(), createAuthenticatedHttpClient(), createHttpClient(), createSharedTestDatabase() (+13 more)

### Community 11 - "API Client Core"
Cohesion: 0.10
Nodes (12): createAuthApi(), buildBaseURL(), OpcApiConfig, createHttpClient(), OpcHttpClient, ROUTES, ROUTES, FutureTaskApiModule (+4 more)

### Community 12 - "Database Package Config"
Cohesion: 0.05
Nodes (37): import, types, dependencies, drizzle-orm, @logact-pub/opc-protocol, pg, devDependencies, drizzle-kit (+29 more)

### Community 13 - "Gateway Task Tests"
Cohesion: 0.06
Nodes (9): assignmentMetadata, createFetchMock(), FakeAgent, FakeMqttClient, requestUrl(), spawn(), spawnCommand(), taskCallbackCalls() (+1 more)

### Community 14 - "Task Repository Layer"
Cohesion: 0.07
Nodes (26): CommandOutcome, createTaskRepository(), DbTransaction, OperationResult, requestHash(), stableJson(), TaskRepository, TaskRepositoryError (+18 more)

### Community 15 - "Gateway CLI Package"
Cohesion: 0.06
Nodes (33): bin, opc-gateway, dependencies, @logact-pub/opc-sdk, @opc/agent-edge, @opc/agent-gateway, description, devDependencies (+25 more)

### Community 16 - "Server Package Config"
Cohesion: 0.06
Nodes (31): dependencies, hono, @hono/node-server, @hono/zod-openapi, jose, @logact-pub/opc-core, @logact-pub/opc-protocol, mqtt (+23 more)

### Community 17 - "Agent Gateway Package Config"
Cohesion: 0.06
Nodes (31): dependencies, @logact-pub/opc-protocol, @logact-pub/opc-sdk, mqtt, @opc/agent-edge, description, devDependencies, @types/node (+23 more)

### Community 18 - "Tasks E2E Tests"
Cohesion: 0.11
Nodes (22): asObject(), assignDraft(), assignPosition(), CapabilityGrantInput, createDepartment(), createDraft(), createPosition(), createStaff() (+14 more)

### Community 19 - "Agent Edge Package Config"
Cohesion: 0.07
Nodes (30): dependencies, @earendil-works/pi-agent-core, @earendil-works/pi-ai, typebox, description, devDependencies, @types/node, typescript (+22 more)

### Community 20 - "Database Client Migrations"
Cohesion: 0.11
Nodes (11): createDbClient(), DbClient, db, runMigrations(), MessageRepository, ParticipantRepository, ParticipantUpdatePatch, CreateRoomInput (+3 more)

### Community 21 - "Protocol Package Config"
Cohesion: 0.08
Nodes (26): dependencies, zod, devDependencies, typescript, exports, import, main, name (+18 more)

### Community 22 - "Mobile App Entry"
Cohesion: 0.13
Nodes (19): queryClient, ServerConfigHydrator(), styles, updateBaseUrl(), ENV, MqttContext, MqttContextValue, MqttProvider() (+11 more)

### Community 23 - "Gateway Unit Tests"
Cohesion: 0.10
Nodes (17): createFakeMqttConnect(), FakeMqttClient, spawnAgent(), startGatewayWithAdmin(), createFakeMqttConnect(), createGateway(), FakeMqttClient, spawnAndWait() (+9 more)

### Community 24 - "Maestro E2E Flows"
Cohesion: 0.20
Nodes (25): Maestro Suite Config (appId, flow order), Flow F1: Login lands on Chats tab, Flow F2: Six-tab navigation, Flow F3: Chats list rendering, Flow F4: Chat room send message, Flow F5: @mention agent in room, Flow F7: New Group creation, Flow F8: Room Info screen (+17 more)

### Community 25 - "Agent Runtime Interface"
Cohesion: 0.10
Nodes (3): logger, startRepl(), IAgent

### Community 26 - "Expo App Config"
Cohesion: 0.08
Nodes (22): package, versionCode, projectId, expo, android, assetBundlePatterns, extra, ios (+14 more)

### Community 28 - "Core Package Config"
Cohesion: 0.08
Nodes (24): devDependencies, @types/node, typescript, exports, import, main, name, publishConfig (+16 more)

### Community 29 - "Authorization E2E Tests"
Cohesion: 0.14
Nodes (18): asObject(), assign(), authorizationSdk(), CapabilityGrantInput, createDepartment(), createPosition(), createRecordingConnect(), JsonObject (+10 more)

### Community 31 - "Organization Repository"
Cohesion: 0.11
Nodes (11): OrganizationRepositoryError, scopeOrder, DepartmentRow, OrganizationRow, organizations, PositionRow, positions, StaffAssignmentRow (+3 more)

### Community 32 - "Organization E2E Tests"
Cohesion: 0.11
Nodes (18): expectSdkError(), applyLegacyMigrations(), applyMigrationRange(), asObject(), closeServer(), CountRow, databaseUrlWithSchema(), expectSdkError() (+10 more)

### Community 33 - "Architecture Docs Concepts"
Cohesion: 0.11
Nodes (23): API contract tests (apps/server/e2e/contract.test.ts), WebSocket-to-MQTT architecture migration (server 1.0.0), @opc/server package changelog, Storage management APIs for rooms, participants, messages, Agent reply uplink chain (runtime -> gateway -> bridge -> mobile UI), Agent registration and spawn chain, HTTP control plane + MQTT data plane topology, Message lifecycle (send, persist, fan-out, render) (+15 more)

### Community 35 - "API Client Package Config"
Cohesion: 0.09
Nodes (22): dependencies, axios, @logact-pub/opc-protocol, zod, description, devDependencies, @types/node, typescript (+14 more)

### Community 36 - "Task SDK Tests"
Cohesion: 0.09
Nodes (9): assignment, event, FutureTaskRoutes, FutureTaskSchemas, routes, RuntimeSchema, schemas, task (+1 more)

### Community 37 - "Mobile Runtime Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, buffer, expo-build-properties, expo-constants, @logact-pub/opc-protocol, @logact-pub/opc-sdk, mqtt, @opc/api-client (+14 more)

### Community 40 - "Agent Edge Types"
Cohesion: 0.13
Nodes (13): AgentRuntimeDeps, createConsoleLogger(), AgentActivityStatus, AgentErrorCode, AgentInfo, AgentLogger, AgentOptions, AgentStateError (+5 more)

### Community 41 - "Pi Thread Runtime"
Cohesion: 0.21
Nodes (4): AGENT, ThreadStatus, PiThread, PiThreadHooks

### Community 44 - "Mobile MQTT Client"
Cohesion: 0.15
Nodes (7): createOpcMqttClient(), EVENTS_QOS, PRESENCE_QOS, UPLINK_QOS, MqttConnectionState, OpcMqttClient, OpcMqttClientOptions

### Community 45 - "MQTT Client Package Config"
Cohesion: 0.11
Nodes (19): dependencies, @logact-pub/opc-protocol, devDependencies, typescript, exports, import, main, name (+11 more)

### Community 46 - "Organization Seed Script"
Cohesion: 0.14
Nodes (17): automationEngineer, engineering, ensureAssignment(), ensureDepartment(), ensureParticipant(), ensurePosition(), expectSuccess(), headquarters (+9 more)

### Community 47 - "Agent Edge Model Tests"
Cohesion: 0.22
Nodes (12): setup(), EMPTY_CONTEXT, StubModels, createFakeStreamFn(), deferred, emitReply(), EMPTY_USAGE, fakeAssistantMessage() (+4 more)

### Community 48 - "Database Schema Tables"
Cohesion: 0.15
Nodes (14): participantKind, Message, messages, NewMessage, departments, NewParticipant, Participant, participants (+6 more)

### Community 49 - "Contacts Screen Tests"
Cohesion: 0.12
Nodes (15): AGENT_BLOCKING, AGENT_ERROR, AGENT_IDLE, AGENT_OFFLINE, AGENT_WORKING, findByTestId(), GATEWAY_ONLINE, mockList (+7 more)

### Community 51 - "Package TSConfig"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+9 more)

### Community 52 - "Package TSConfig"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+9 more)

### Community 53 - "Protocol Wire Contracts"
Cohesion: 0.11
Nodes (12): AuthorizationMqttContract, AuthorizationSchemaContract, AuthorizationWireContract, RuntimeSchema, CreatePositionRequestSchema, DepartmentNodeSchema, GatewayCommandSchema, OrganizationErrorResponseSchema (+4 more)

### Community 54 - "Package TSConfig"
Cohesion: 0.11
Nodes (17): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module (+9 more)

### Community 55 - "API Client Errors Auth"
Cohesion: 0.19
Nodes (11): ApiProblem, AxiosLikeError, isConflictProblem(), normalizeApiError(), authApi, setAuthToken(), clearCredentials(), loadCredentials() (+3 more)

### Community 56 - "Chat Screen Tests"
Cohesion: 0.13
Nodes (13): DM_ROOM, findByTestId(), indicatorText(), ME, mockBroadcast, mockEnterRoom, mockGetParticipant, mockGetRoom (+5 more)

### Community 57 - "Pi Transcript Mapping"
Cohesion: 0.23
Nodes (10): AgentId, AgentMessage, fromPiTranscript(), piAssistantText(), piMessageToAgentMessage(), CTX, toPiUserMessage(), TranscriptContext (+2 more)

### Community 58 - "Gateway CLI Support"
Cohesion: 0.17
Nodes (11): AdminClientEnv, AdminUnreachableError, logger, GatewayEnv, logger, createLogger(), formatExtra(), formatValue() (+3 more)

### Community 59 - "Server HTTP Assembly"
Cohesion: 0.24
Nodes (14): createAuthorizationService(), messageResource(), participantResource(), roomResource(), respondParticipantOrganizationError(), createServer(), delegatedTaskCallbackPaths, ErrorResponseSchema (+6 more)

### Community 60 - "SDK Package Config"
Cohesion: 0.14
Nodes (14): description, exports, import, main, name, private, scripts, build (+6 more)

### Community 61 - "Gateway Changesets"
Cohesion: 0.22
Nodes (14): Issue #64: AgentGateway per-agent model config from agent.spawn, Issue #64: Gateway discovery and spawn payload forwarding (server/sdk/api-client), Issue #64: Protocol — gateway kind, AgentModelConfig, agent.spawn name/model, agent.spawn command (GatewaySpawnCommandSchema), Issue #64: Mobile Add Agent rebuilt as gateway-based creation flow, Issue #69: Re-registration corrects participant kind (human → gateway/agent), Issue #73: Protocol — Participant.gatewayId and gatewayId list filter, Participant.gatewayId agent-to-gateway ownership field (+6 more)

### Community 62 - "Add Agent Catalog Tests"
Cohesion: 0.16
Nodes (11): CATALOG, changeText(), findByTestId(), GATEWAY_NO_CATALOG, GATEWAY_WITH_CATALOG, mockCreateDirect, mockList, mockLoadRooms (+3 more)

### Community 63 - "SDK MQTT Client"
Cohesion: 0.27
Nodes (3): connectClient(), MQTT_TOPICS, OpcClient

### Community 64 - "CI Workflows"
Cohesion: 0.22
Nodes (14): Mobile E2E Infrastructure Fixes, Setup pnpm + Node Composite Action, GitHub Flow Branching Model, Release Process (Tag to Docker), Build Mosquitto Image Workflow, Reusable Code Checks Workflow, Main CI Pipeline, Mobile E2E (Maestro) Workflow (+6 more)

### Community 66 - "Organization API Routes"
Cohesion: 0.14
Nodes (14): createOrganizationApi(), route(), CreateDepartmentResponseSchema, CreatePositionResponseSchema, CreateStaffAssignmentResponseSchema, DeleteDepartmentResponseSchema, DeletePositionResponseSchema, DeleteStaffAssignmentResponseSchema (+6 more)

### Community 67 - "Authorization Service"
Cohesion: 0.21
Nodes (9): ActorPolicy, AssignmentGrant, AuthorizationService, LEADER_CAPABILITIES, ServerEnv, organizationErrorResponses, registerOrganizationRoutes(), respondOrganizationError() (+1 more)

### Community 68 - "Owner Bootstrap"
Cohesion: 0.19
Nodes (9): BootstrapDeps, BootstrapEnv, bootstrapFirstOwner(), bridge, db, eventPublisher, organizationRepo, participantRepo (+1 more)

### Community 69 - "Gateway Model Tests"
Cohesion: 0.19
Nodes (8): createFakeMqttConnect(), createFetchMock(), createGateway(), { createModelConfigMock, createModelConfigFromEnvMock }, FakeMqttClient, start(), startAndSpawn(), TestGatewayOptions

### Community 70 - "iOS App Delegate"
Cohesion: 0.18
Nodes (11): Any, AppDelegate, Bool, ExpoAppDelegate, ExpoReactNativeFactoryDelegate, NSUserActivity, RCTReactNativeFactory, UIApplication (+3 more)

### Community 71 - "Task List Screen"
Cohesion: 0.21
Nodes (8): Navigation, Scope, SCOPES, STATUSES, styles, tasks, filterTasksForScope(), TaskScope

### Community 72 - "Add Agent Screen Tests"
Cohesion: 0.20
Nodes (9): changeText(), findByTestId(), GATEWAY, mockCreateDirect, mockList, mockLoadRooms, mockNavigate, mockRegister (+1 more)

### Community 73 - "Server MQTT Bridge"
Cohesion: 0.20
Nodes (6): TestServer, createMqttBridge(), MqttBridge, MqttBridgeOptions, createBridge(), FakeMqttClient

### Community 74 - "Task HTTP Routes"
Cohesion: 0.23
Nodes (7): AuthorizationDeniedError, registerTaskRoutes(), respondTaskError(), taskErrorResponses, TaskService, TaskServiceError, TransitionInput

### Community 75 - "Changeset Config"
Cohesion: 0.17
Nodes (11): access, baseBranch, changelog, commit, fixed, linked, privatePackages, tag (+3 more)

### Community 76 - "Admin Client Commands"
Cohesion: 0.31
Nodes (3): AdminClient, cmdAgents(), cmdThreads()

### Community 77 - "Server Unit Tests"
Cohesion: 0.18
Nodes (7): makeServer(), mockAuthorizationAuditRepo, mockMessageRepo, mockOrganizationRepo, mockParticipantRepo, mockRoomRepo, mockTaskRepo

### Community 78 - "Authorization Changesets"
Cohesion: 0.31
Nodes (10): Issue #112: Organization-scoped authorization (HTTP + MQTT), Closed capability catalog (protocol-owned capability names), Participant-addressed MQTT uplink topic opc/participants/{participantId}/rooms/{roomId}/uplink, Issue #113: Mobile organization administration and task center, Issue #114: Remove #112 authorization compatibility layer and legacy uplink topic, Issue #122: Seed first org owner from env, close open-door bootstrap, First org owner bootstrap (env-seeded, idempotent), Issue #124: Mobile password login via /api/v1/auth/login JWT (+2 more)

### Community 79 - "Gateway CLI Entry"
Cohesion: 0.38
Nodes (9): cmdStatus(), dispatchCommand(), logger, main(), pad(), printTable(), showHelp(), startCliRepl() (+1 more)

### Community 80 - "Android Main Activity"
Cohesion: 0.20
Nodes (5): MainActivity, Bundle, ReactActivity, ReactActivityDelegate, String

### Community 81 - "Room Info Screen Tests"
Cohesion: 0.22
Nodes (8): AGENT_WORKING, findByTestId(), HUMAN_ONLINE, ME, mockGetParticipant, mockGetRoom, presenceDotColor(), ROOM

### Community 82 - "Task Assignment Tests"
Cohesion: 0.20
Nodes (7): mockDepartments, mockMutate, mockNavigate, mockParticipants, mockReplace, mockStaff, mockTask

### Community 83 - "E2E TSConfig"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, declarationMap, noEmit, sourceMap, extends, include (+1 more)

### Community 84 - "Edge Runtime Config"
Cohesion: 0.33
Nodes (7): EdgeConfig, TODO: connect gateway, register tool engine., startEdgeRuntime(), createModelConfig(), createModelConfigFromEnv(), EdgeModelConfig, EdgeModelOptions

### Community 85 - "iOS App Config"
Cohesion: 0.22
Nodes (8): projectId, expo, extra, ios, eas, ITSAppUsesNonExemptEncryption, bundleIdentifier, infoPlist

### Community 86 - "Package TSConfig"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, exclude, extends, include, references

### Community 87 - "Package TSConfig"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, exclude, extends, include, references

### Community 89 - "Rooms API Routes"
Cohesion: 0.22
Nodes (9): createRoomsApi(), BroadcastMessageResponseSchema, CreateDirectRoomResponseSchema, CreateRoomResponseSchema, GetRoomResponseSchema, ListRoomsResponseSchema, RemoveRoomMemberResponseSchema, RoomHistoryResponseSchema (+1 more)

### Community 90 - "Tasks API Routes"
Cohesion: 0.31
Nodes (8): createTasksApi(), route(), taskRoute(), AppendTaskEventResponseSchema, CreateTaskResponseSchema, GetTaskResponseSchema, ListTasksResponseSchema, RecommendTaskResponseSchema

### Community 91 - "Package TSConfig"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, exclude, extends, include, references

### Community 92 - "Package TSConfig"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, exclude, extends, include, references

### Community 93 - "Package TSConfig"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, exclude, extends, include, references

### Community 94 - "Android Main Application"
Cohesion: 0.25
Nodes (5): Application, MainApplication, Configuration, ReactApplication, ReactHost

### Community 95 - "Package TSConfig"
Cohesion: 0.25
Nodes (7): compilerOptions, composite, outDir, rootDir, exclude, extends, include

### Community 96 - "Package TSConfig"
Cohesion: 0.25
Nodes (7): compilerOptions, composite, outDir, rootDir, exclude, extends, include

### Community 97 - "Authorization Audit Store"
Cohesion: 0.32
Nodes (4): AuthorizationAuditRepository, authorizationAudit, AuthorizationAuditRow, NewAuthorizationAuditRow

### Community 98 - "Agent Task Execution Tests"
Cohesion: 0.25
Nodes (6): assignmentMetadata, FutureAgentTaskSchemas, FutureAgentTaskWire, RuntimeSchema, schemas, wire

### Community 99 - "Package TSConfig"
Cohesion: 0.25
Nodes (7): compilerOptions, composite, outDir, rootDir, exclude, extends, include

### Community 100 - "iOS React Native Delegate"
Cohesion: 0.38
Nodes (5): ReactNativeDelegate, url, url, RCTBridge, URL

### Community 101 - "Org Tree Screen Tests"
Cohesion: 0.29
Nodes (5): mockHydrate, mockLeaf, mockNavigate, mockRefetch, mockTree

### Community 103 - "SDK Native Dependencies"
Cohesion: 0.29
Nodes (7): dependencies, buffer, @logact-pub/opc-protocol, mqtt, react-native-tcp-socket, stream-browserify, zod

### Community 104 - "Agent Mention Workflow Test"
Cohesion: 0.29
Nodes (4): REPO_ROOT, WORKFLOW_PATH, WorkflowDoc, WORKFLOWS_DIR

### Community 105 - "iOS App Dependencies"
Cohesion: 0.33
Nodes (5): expo, react, Expo, React, ReactAppDependencyProvider

### Community 107 - "Package TSConfig"
Cohesion: 0.33
Nodes (5): compilerOptions, types, exclude, extends, include

### Community 108 - "Maestro Fail Fast Script"
Cohesion: 0.53
Nodes (5): fail_env(), is_excluded(), MAESTRO_DRIVER_STARTUP_TIMEOUT, run-fail-fast.sh script, tcp_open()

### Community 109 - "Model Catalog Changesets"
Cohesion: 0.70
Nodes (5): Issue #70: api-client/mobile consume gateway model catalog in Add Agent, Issue #70: Gateway reports model catalog at startup (buildModelCatalog), Issue #70: Protocol — GatewayModelCatalog/ModelInfo/ProviderModels schemas, GatewayModelCatalog (metadata.modelCatalog), Issue #70: Server PATCH /participants/{id} persists modelCatalog

### Community 110 - "Core Architecture Rationale"
Cohesion: 0.40
Nodes (5): 单连接多路复用数据面（issue #80）, changeset: 消息 intent（task|question）端到端支持（issue #104）, broker go-auth HTTP 认证/ACL 回调, OPC IM 系统架构（broker 中心化解耦）, uplink → 落库 → events 消息链路

### Community 111 - "Docker Compose Stacks"
Cohesion: 0.80
Nodes (5): Server 首个 owner bootstrap（issue #122）, docker-compose.yml 基础栈（postgres + mosquitto build）, docker-compose.dev.yml 开发栈, docker-compose.prod.yml 生产栈, docker-compose.staging.yml 预发栈

### Community 112 - "Issue Workflow Skill"
Cohesion: 0.90
Nodes (5): bug 工作流（reproduce → analyze → 回归测试 → fix）, 工作流共享约定（labels / board 映射 / 人工门协议 / 追踪）, feat 工作流（align/e2e 人工门控 → plan → implement → PR）, Orca worker 模式契约（worker_done 上报）, GitHub Issue Workflow skill（按 label 路由）

### Community 116 - "Participants API Routes"
Cohesion: 0.40
Nodes (5): createParticipantsApi(), GetParticipantResponseSchema, ListParticipantsResponseSchema, RegisterParticipantResponseSchema, UpdateParticipantResponseSchema

### Community 118 - "ACR Deploy Script"
Cohesion: 0.70
Nodes (4): fail(), pass(), run_remote(), e2e-issue-81-acr-deploy.sh script

### Community 119 - "Gateway Control Changesets"
Cohesion: 0.67
Nodes (4): Agent Gateway 控制面（agent.spawn/agent.stop）, packages/protocol 唯一 API 契约来源, changeset: protocol 支持 agent gateway 控制面, changeset: server/sdk agent gateway 集成

### Community 120 - "Splash Logo Assets"
Cohesion: 0.67
Nodes (4): Concentric Circle Brand Mark, Keyline Construction Grid, mdpi Density Drawable Variant, Android Splash Screen Logo (mdpi)

### Community 121 - "Gradle Wrapper Script"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 122 - "Jest Config"
Cohesion: 0.50
Nodes (3): jestPresetDir, path, reactNativeDir

### Community 123 - "Metro Config"
Cohesion: 0.50
Nodes (3): config, { getDefaultConfig }, path

### Community 125 - "React Native Bootstrap Docs"
Cohesion: 0.50
Nodes (4): CocoaPods iOS dependency installation, Fast Refresh, Metro JavaScript dev server, React Native project bootstrap (@react-native-community/cli)

### Community 128 - "Vitest Dependencies"
Cohesion: 0.50
Nodes (4): devDependencies, @types/node, typescript, vitest

### Community 133 - "Presence Protocol Changesets"
Cohesion: 1.00
Nodes (3): Presence Protocol Schema (Issue #72), SDK Presence Reporting (Issue #72), Presence Server & Mobile Implementation (Issue #72)

### Community 134 - "Changeset Versioning Docs"
Cohesion: 0.67
Nodes (3): Changesets-Driven Versioning, PR Template API Contract Checklist, Changeset Presence Check Workflow

## Knowledge Gaps
- **945 isolated node(s):** `gate-watch.sh script`, `$schema`, `changelog`, `commit`, `fixed` (+940 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **56 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `API_ROUTES` connect `Server Events Tasks` to `Organization API Routes`, `Authorization Service`, `Task SDK Tests`, `Agent Gateway Core`, `Gateway Admin Server`, `Task HTTP Routes`, `Protocol Wire Contracts`, `Rooms API Routes`, `Server HTTP Assembly`?**
  _High betweenness centrality (0.142) - this node is a cross-community bridge._
- **Why does `createServer()` connect `Server HTTP Assembly` to `Organization E2E Tests`, `Server Events Tasks`, `Authorization Service`, `Owner Bootstrap`, `Gateway E2E Tests`, `Task HTTP Routes`, `Server Unit Tests`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Why does `registerOrganizationRoutes()` connect `Authorization Service` to `Organization E2E Tests`, `Server Events Tasks`, `Server HTTP Assembly`, `Capability Store Tests`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **What connects `gate-watch.sh script`, `$schema`, `changelog` to the rest of the system?**
  _959 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Task Org API Schemas` be split into smaller, more focused modules?**
  _Cohesion score 0.012987012987012988 - nodes in this community are weakly interconnected._
- **Should `Protocol Schema Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.021052631578947368 - nodes in this community are weakly interconnected._
- **Should `Server Events Tasks` be split into smaller, more focused modules?**
  _Cohesion score 0.055381400208986416 - nodes in this community are weakly interconnected._