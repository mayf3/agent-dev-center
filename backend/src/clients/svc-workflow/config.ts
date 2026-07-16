import { env } from '../../config/env.js';
import { WorkflowClient } from './client.js';
import type { WorkflowClientDependencies } from './contracts.js';
import { WorkflowConfigurationError } from './errors.js';

export interface WorkflowSmokeFixture {
  domainId: string;
  definitionVersionId: string;
  transitionDefinitionId: string;
}

export function createSmokeWorkflowClient(
  dependencies: WorkflowClientDependencies = {},
): { client: WorkflowClient; fixture: WorkflowSmokeFixture } {
  if (env.SVC_WORKFLOW_SMOKE_CONFIRM !== 'isolated-test-only') {
    throw new WorkflowConfigurationError(
      'SVC_WORKFLOW_SMOKE_CONFIRM must equal isolated-test-only',
    );
  }

  const token = required(
    'SVC_WORKFLOW_SMOKE_ACCESS_TOKEN',
    env.SVC_WORKFLOW_SMOKE_ACCESS_TOKEN,
  );
  const fixture = {
    domainId: required('SVC_WORKFLOW_SMOKE_DOMAIN_ID', env.SVC_WORKFLOW_SMOKE_DOMAIN_ID),
    definitionVersionId: required(
      'SVC_WORKFLOW_SMOKE_DEFINITION_VERSION_ID',
      env.SVC_WORKFLOW_SMOKE_DEFINITION_VERSION_ID,
    ),
    transitionDefinitionId: required(
      'SVC_WORKFLOW_SMOKE_TRANSITION_DEFINITION_ID',
      env.SVC_WORKFLOW_SMOKE_TRANSITION_DEFINITION_ID,
    ),
  };

  const client = new WorkflowClient(
    {
      baseUrl: env.SVC_WORKFLOW_BASE_URL,
      requestTimeoutMs: env.SVC_WORKFLOW_REQUEST_TIMEOUT_MS,
      maxAttempts: env.SVC_WORKFLOW_MAX_ATTEMPTS,
      accessTokenProvider: () => token,
    },
    dependencies,
  );
  return { client, fixture };
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new WorkflowConfigurationError(`${name} is required for the isolated smoke`);
  }
  return value;
}
