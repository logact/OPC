import type {
  createOrganizationRepository,
  createParticipantRepository,
} from '@opc/database';

export interface BootstrapDeps {
  participantRepo: ReturnType<typeof createParticipantRepository>;
  organizationRepo: ReturnType<typeof createOrganizationRepository>;
}

export interface BootstrapEnv {
  OPC_BOOTSTRAP_OWNER_ID?: string;
  OPC_BOOTSTRAP_OWNER_PASSWORD?: string;
}

/**
 * issue #122：server 启动时从环境变量种子首个 org owner。
 *
 * - `OPC_BOOTSTRAP_OWNER_ID` + `OPC_BOOTSTRAP_OWNER_PASSWORD` 必须同时设置，
 *   只设置一个直接抛错（启动失败）。
 * - 严格幂等：已存在 owner 时忽略环境变量（打 warning 提示运维移除），
 *   绝不允许 env 静默重置现有 owner 的密码。
 * - 未设置 env 且库中无 owner 时保持启动（dev 便利），但大声告警：
 *   此时唯一 bootstrap 路径是未鉴权的首个人类注册（open door，
 *   仅在 OPC_ALLOW_OPEN_BOOTSTRAP=true 时放行）。
 */
export async function bootstrapFirstOwner(
  { participantRepo, organizationRepo }: BootstrapDeps,
  env: BootstrapEnv = process.env
): Promise<void> {
  const ownerId = env.OPC_BOOTSTRAP_OWNER_ID?.trim();
  const ownerPassword = env.OPC_BOOTSTRAP_OWNER_PASSWORD;

  if (!ownerId && !ownerPassword) {
    if (!(await organizationRepo.hasOwner())) {
      console.warn(
        '[bootstrap] no owner exists and OPC_BOOTSTRAP_OWNER_ID / OPC_BOOTSTRAP_OWNER_PASSWORD are not set; ' +
          'set them to seed the first owner declaratively. Without them the only bootstrap path is the ' +
          'unauthenticated first-human registration (requires OPC_ALLOW_OPEN_BOOTSTRAP=true).'
      );
    }
    return;
  }

  if (!ownerId || !ownerPassword) {
    throw new Error(
      'OPC_BOOTSTRAP_OWNER_ID and OPC_BOOTSTRAP_OWNER_PASSWORD must be set together; only one was provided'
    );
  }

  if (await organizationRepo.hasOwner()) {
    console.warn(
      `[bootstrap] an owner already exists; ignoring OPC_BOOTSTRAP_OWNER_ID (${ownerId}) — ` +
        'remove the bootstrap env vars from your deployment to avoid keeping credentials around'
    );
    return;
  }

  // 与 POST /api/v1/participants 首个人类注册走同一代码路径（register + reconcile）
  const { participant } = await participantRepo.register(ownerId, ownerId, 'human', ownerPassword);
  await organizationRepo.reconcileParticipant(
    participant.id,
    participant.kind,
    participant.kind === 'human'
  );
  console.log(`[bootstrap] seeded first owner from env: ${participant.id}`);
}
