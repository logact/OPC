-- issue #137：#130 从 CapabilityNameSchema 移除了 task.* 等能力，但存量
-- positions.capability_grants 仍可能携带这些已移除的 capability，导致 org 接口
-- 响应无法通过客户端 Zod 校验（mobile 组织页报错）。本迁移清洗目录外 grant；
-- 授权语义不变——未知 capability 本来就匹配不到任何 action。读取侧另有兜底过滤，
-- 见 packages/database/src/repositories/organization.ts sanitizeCapabilityGrants。
UPDATE "positions"
SET "capability_grants" = COALESCE((
  SELECT jsonb_agg(elem)
  FROM jsonb_array_elements("capability_grants") AS elem
  WHERE elem->>'capability' IN (
    'organization.read','organization.manage',
    'department.read','department.manage',
    'position.read','position.manage',
    'staff.read','staff.manage',
    'participant.read','participant.manage',
    'agent.manage',
    'room.create','room.read','room.manage','room.members.manage',
    'message.read','message.send',
    'capability.delegate',
    'authorization.audit.read'
  )
), '[]'::jsonb);--> statement-breakpoint
