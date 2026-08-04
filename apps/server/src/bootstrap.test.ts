import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapFirstOwner, type BootstrapDeps } from './bootstrap.js';

function makeDeps(hasOwner: boolean) {
  const participantRepo = {
    register: vi.fn().mockResolvedValue({
      participant: { id: 'owner-1', kind: 'human' },
      token: 'tok',
    }),
  };
  const organizationRepo = {
    hasOwner: vi.fn().mockResolvedValue(hasOwner),
    reconcileParticipant: vi.fn().mockResolvedValue(undefined),
  };
  return {
    deps: { participantRepo, organizationRepo } as unknown as BootstrapDeps,
    participantRepo,
    organizationRepo,
  };
}

describe('bootstrapFirstOwner (issue #122)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when env vars are absent and an owner already exists', async () => {
    const { deps, participantRepo } = makeDeps(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await bootstrapFirstOwner(deps, {});

    expect(participantRepo.register).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns loudly when env vars are absent and no owner exists (open door)', async () => {
    const { deps, participantRepo } = makeDeps(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await bootstrapFirstOwner(deps, {});

    expect(participantRepo.register).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('fails fast when only OPC_BOOTSTRAP_OWNER_ID is set', async () => {
    const { deps, participantRepo } = makeDeps(false);

    await expect(
      bootstrapFirstOwner(deps, { OPC_BOOTSTRAP_OWNER_ID: 'owner-1' })
    ).rejects.toThrow(/must be set together/);
    expect(participantRepo.register).not.toHaveBeenCalled();
  });

  it('fails fast when only OPC_BOOTSTRAP_OWNER_PASSWORD is set', async () => {
    const { deps, participantRepo } = makeDeps(false);

    await expect(
      bootstrapFirstOwner(deps, { OPC_BOOTSTRAP_OWNER_PASSWORD: 'secret' })
    ).rejects.toThrow(/must be set together/);
    expect(participantRepo.register).not.toHaveBeenCalled();
  });

  it('seeds the first owner through register + reconcileParticipant when no owner exists', async () => {
    const { deps, participantRepo, organizationRepo } = makeDeps(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await bootstrapFirstOwner(deps, {
      OPC_BOOTSTRAP_OWNER_ID: 'owner-1',
      OPC_BOOTSTRAP_OWNER_PASSWORD: 'secret',
    });

    expect(participantRepo.register).toHaveBeenCalledWith('owner-1', 'owner-1', 'human', 'secret');
    expect(organizationRepo.reconcileParticipant).toHaveBeenCalledWith('owner-1', 'human', true);
    expect(log).toHaveBeenCalledOnce();
  });

  it('ignores the env vars and warns when an owner already exists (idempotent, no password reset)', async () => {
    const { deps, participantRepo, organizationRepo } = makeDeps(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await bootstrapFirstOwner(deps, {
      OPC_BOOTSTRAP_OWNER_ID: 'owner-1',
      OPC_BOOTSTRAP_OWNER_PASSWORD: 'secret',
    });

    expect(participantRepo.register).not.toHaveBeenCalled();
    expect(organizationRepo.reconcileParticipant).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});
