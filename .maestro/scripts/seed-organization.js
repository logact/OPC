// Seeds deterministic organization and staffing fixtures through the public
// protocol routes. The fixture admin is intentionally separate from every
// mobile persona so refreshing its token never invalidates the app session.
//
// The shared mobile E2E server currently runs OPC_AUTHORIZATION_MODE=compat.
// On an enforcing server, provide an equivalent owner-created fixture before
// running these journeys.
const base =
  (typeof OPC_SERVER_URL !== 'undefined' && OPC_SERVER_URL) ||
  'http://localhost:3000';

function parseBody(response) {
  if (!response.body) return {};
  return JSON.parse(response.body);
}

function expectSuccess(response, operation) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(operation + ' failed (' + response.status + '): ' + response.body);
  }
  return parseBody(response);
}

const adminRegistration = expectSuccess(
  http.post(base + '/api/v1/participants', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'maestro-fixture-admin',
      name: 'Maestro Fixture Admin',
      kind: 'human',
    }),
  }),
  'register fixture admin'
);
const token = adminRegistration.token;

function request(method, path, body) {
  const options = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return expectSuccess(http.request(base + path, options), method + ' ' + path);
}

function ensureParticipant(id, name, kind, gatewayId) {
  const payload = { id: id, name: name, kind: kind };
  if (gatewayId) {
    payload.gatewayId = gatewayId;
    payload.model = { provider: 'openai', id: 'gpt-5' };
  }
  return request('POST', '/api/v1/participants', payload);
}

// The task agent is attached to the conventional Maestro gateway. A live
// gateway is only required by the agent-backend flow; core flows merely render
// this agent consistently alongside humans.
ensureParticipant('maestro-task-agent', 'Task Runner', 'agent', 'maestro-gateway');

let departments = request('GET', '/api/v1/organization/departments').departments;

function ensureDepartment(name, parentId) {
  const existing = departments.find(function (department) {
    return department.name === name && department.parentId === parentId;
  });
  if (existing) return existing;
  const created = request('POST', '/api/v1/organization/departments', {
    name: name,
    parentId: parentId,
  }).department;
  departments.push(created);
  return created;
}

const headquarters = ensureDepartment('Maestro HQ', null);
const engineering = ensureDepartment('Engineering', headquarters.id);
const platform = ensureDepartment('Platform', engineering.id);
const runtime = ensureDepartment('Runtime', platform.id);
const quality = ensureDepartment('Quality', platform.id);

let positions = request('GET', '/api/v1/organization/positions').positions;

function grants(names) {
  return names.map(function (capability) {
    return { capability: capability, scope: { type: 'organization' } };
  });
}

function ensurePosition(departmentId, name, details) {
  const existing = positions.find(function (position) {
    return position.name === name && position.departmentId === departmentId;
  });
  if (existing) return existing;
  const created = request(
    'POST',
    '/api/v1/organization/positions',
    Object.assign({ departmentId: departmentId, name: name }, details)
  ).position;
  positions.push(created);
  return created;
}

const mobileAdmin = ensurePosition(headquarters.id, 'Mobile Workflow Admin', {
  description: 'Administers the mobile organization and task workflows',
  responsibilities: [
    {
      id: 'mobile-workflows',
      title: 'Mobile workflows',
      description: 'Manage organization structure, staffing, and task delivery',
    },
  ],
  skillTags: ['leadership', 'mobile'],
  capabilityGrants: grants([
    'organization.read',
    'organization.manage',
    'department.read',
    'department.manage',
    'position.read',
    'position.manage',
    'staff.read',
    'staff.manage',
    'participant.read',
    'participant.manage',
    'agent.manage',
    'task.create',
    'task.read',
    'task.manage',
    'task.assign',
    'task.review',
    'capability.delegate',
  ]),
});

const platformEngineer = ensurePosition(platform.id, 'Platform Engineer', {
  description: 'Builds the mobile platform',
  responsibilities: [
    {
      id: 'ship-mobile',
      title: 'Ship mobile',
      description: 'Deliver reliable React Native features',
    },
  ],
  skillTags: ['react-native', 'typescript'],
  capabilityGrants: grants(['organization.read', 'department.read', 'position.read', 'staff.read', 'task.read']),
});

const reviewer = ensurePosition(quality.id, 'Quality Reviewer', {
  description: 'Reviews task results',
  responsibilities: [
    {
      id: 'review-results',
      title: 'Review results',
      description: 'Approve or reject submitted work',
    },
  ],
  skillTags: ['quality'],
  capabilityGrants: grants(['organization.read', 'department.read', 'staff.read', 'task.read', 'task.review']),
});

const automationEngineer = ensurePosition(runtime.id, 'Automation Engineer', {
  description: 'Executes delegated tasks automatically',
  responsibilities: [
    {
      id: 'execute-automation',
      title: 'Execute automation',
      description: 'Run tasks and report progress',
    },
  ],
  skillTags: ['automation', 'typescript'],
  capabilityGrants: grants(['organization.read', 'department.read', 'staff.read', 'task.read']),
});

function ensureAssignment(participantId, position, isLeader) {
  const staff = request(
    'GET',
    '/api/v1/organization/staff/' + encodeURIComponent(participantId)
  ).staff;
  const existing = staff.assignments.find(function (assignment) {
    return assignment.positionId === position.id;
  });
  if (!existing) {
    return request(
      'POST',
      '/api/v1/organization/staff/' + encodeURIComponent(participantId) + '/assignments',
      {
        positionId: position.id,
        active: true,
        isDepartmentLeader: isLeader,
      }
    ).assignment;
  }
  if (!existing.active || existing.isDepartmentLeader !== isLeader) {
    return request(
      'PATCH',
      '/api/v1/organization/assignments/' + encodeURIComponent(existing.id),
      { active: true, isDepartmentLeader: isLeader }
    ).assignment;
  }
  return existing;
}

ensureAssignment('maestro-e2e', mobileAdmin, true);
ensureAssignment('maestro-alice', platformEngineer, false);
ensureAssignment('maestro-ben', reviewer, false);
ensureAssignment('maestro-codebot', automationEngineer, false);
ensureAssignment('maestro-task-agent', automationEngineer, false);

const runId = String(Date.now());
output.headquartersDepartmentId = headquarters.id;
output.engineeringDepartmentId = engineering.id;
output.platformDepartmentId = platform.id;
output.runtimeDepartmentId = runtime.id;
output.qualityDepartmentId = quality.id;
output.platformEngineerPositionId = platformEngineer.id;
output.taskAgentId = 'maestro-task-agent';
output.runId = runId;
output.humanTaskTitle = 'Human review ' + runId;
output.cancelledTaskTitle = 'Cancelled draft ' + runId;
output.agentTaskTitle = 'Agent execution ' + runId;
