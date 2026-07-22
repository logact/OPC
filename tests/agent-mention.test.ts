/**
 * E2E tests for issue #9 — GitHub Action handling `@lobe` code-agent mentions.
 *
 * These tests encode the acceptance criteria from the approved align spec
 * (issue comment `<!-- gate:align -->`). They intentionally FAIL until
 * `.github/workflows/agent-mention.yml` is implemented in the implement step.
 *
 * Harness choice: the lightest sensible harness for a GitHub Actions workflow
 * is a structural test — parse the workflow YAML and assert its
 * trigger/filter/permissions/concurrency contract, plus optional actionlint
 * when the binary is available. No Actions runner or network is required.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');
const WORKFLOW_PATH = join(WORKFLOWS_DIR, 'agent-mention.yml');

interface WorkflowDoc {
  name?: string;
  on?: unknown;
  permissions?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs?: Record<string, { permissions?: Record<string, string>; if?: string; steps?: Array<Record<string, unknown>> }>;
}

function loadWorkflow(): { raw: string; doc: WorkflowDoc } {
  const raw = readFileSync(WORKFLOW_PATH, 'utf8');
  return { raw, doc: parse(raw) as WorkflowDoc };
}

/** `on` may parse as string key ("on", YAML 1.2) or boolean key (true, YAML 1.1). */
function onBlock(doc: WorkflowDoc): Record<string, unknown> {
  const on = doc.on ?? (doc as Record<string | symbol, unknown>)[true as unknown as string];
  return (typeof on === 'object' && on !== null ? on : {}) as Record<string, unknown>;
}

describe('issue #9: agent-mention workflow (@lobe code-agent handler)', () => {
  it('AC1: .github/workflows/agent-mention.yml exists and triggers on issue_comment(created)', () => {
    expect(existsSync(WORKFLOW_PATH), 'workflow file .github/workflows/agent-mention.yml must exist').toBe(true);

    const { doc } = loadWorkflow();
    const issueComment = onBlock(doc).issue_comment as undefined | { types?: string[] } | string[];
    expect(issueComment, 'workflow must trigger on the issue_comment event').toBeDefined();

    // Either unrestricted (no `types`) or explicitly including `created`.
    const types = Array.isArray(issueComment) ? issueComment : issueComment?.types;
    if (types) {
      expect(types).toContain('created');
    }
  });

  it('AC2: agent handling is gated on the comment body containing a @lobe mention', () => {
    const { raw } = loadWorkflow();
    // A conditional (job- or step-level `if:`) that inspects the comment body for @lobe,
    // so plain comments trigger the run but no-op without invoking the agent.
    expect(raw).toMatch(/contains\([^)]*comment\.body[^)]*@lobe/);
  });

  it('AC3: bot/self comments are filtered out (no self-trigger loop)', () => {
    const { raw } = loadWorkflow();
    // Any guard that excludes bot authors — e.g. `user.type != 'Bot'` or a sender-login check.
    expect(raw).toMatch(/user\.type[^'\n]*'Bot'|'Bot'[^'\n]*user\.type|sender\.login/);
  });

  it('AC4: the workflow posts a 🤖 status comment back to the issue/PR when handling', () => {
    const { raw } = loadWorkflow();
    expect(raw).toContain('🤖');
    expect(raw).toMatch(/gh (issue|pr) comment|gh api [^\n]*comments/);
  });

  it('AC5: workflow conventions — valid YAML, least-privilege permissions, concurrency, pinned actions', () => {
    const { raw, doc } = loadWorkflow();
    expect(doc, 'workflow must be valid YAML').toBeTypeOf('object');

    // Least-privilege permissions at top level or job level.
    const perms = doc.permissions ?? Object.values(doc.jobs ?? {}).map((job) => job.permissions)[0] ?? {};
    expect(perms.contents).toBe('read');
    expect(perms.issues).toBe('write');
    expect(perms['pull-requests']).toBe('write');

    // Concurrency keyed by the issue/PR number so duplicate mentions don't double-run.
    const group = doc.concurrency?.group ?? '';
    expect(group.length, 'workflow must declare a concurrency group').toBeGreaterThan(0);
    expect(group).toMatch(/issue\.number|github\.event\.issue/);

    // Every third-party action is pinned to a full 40-char commit SHA.
    const uses = [...raw.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    expect(uses.length, 'workflow should use at least one action (e.g. checkout)').toBeGreaterThan(0);
    for (const use of uses) {
      expect(use, `action "${use}" must be pinned to a full commit SHA`).toMatch(/@[0-9a-f]{40}$/);
    }

    // Equivalent yaml validation: run actionlint when the binary is available.
    let actionlint: string | null = null;
    try {
      actionlint = execFileSync('which', ['actionlint'], { encoding: 'utf8' }).trim() || null;
    } catch {
      actionlint = null;
    }
    if (actionlint) {
      expect(() => execFileSync(actionlint, [WORKFLOW_PATH])).not.toThrow();
    }
  });

  it('AC6: existing workflows are untouched and still parse as valid YAML', () => {
    const others = readdirSync(WORKFLOWS_DIR)
      .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
      .filter((file) => file !== 'agent-mention.yml');
    expect(others.length).toBeGreaterThan(0);
    for (const file of others) {
      const doc = parse(readFileSync(join(WORKFLOWS_DIR, file), 'utf8')) as unknown;
      expect(doc, `${file} must remain valid YAML`).toBeTypeOf('object');
    }
  });
});
