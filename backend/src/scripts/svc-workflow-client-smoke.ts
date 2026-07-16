import { randomUUID } from 'node:crypto';
import { WorkflowApiError, WorkflowClientError } from '../clients/svc-workflow/index.js';
import { createSmokeWorkflowClient } from '../clients/svc-workflow/config.js';

async function main(): Promise<void> {
  const { client, fixture } = createSmokeWorkflowClient();
  const runId = randomUUID();
  const createKey = `adc-client-smoke-create-${runId}`;
  const transitionKey = `adc-client-smoke-transition-${runId}`;
  const createInput = {
    domainId: fixture.domainId,
    definitionVersionId: fixture.definitionVersionId,
    externalReference: `adc-client-smoke-${runId}`,
    metadata: { source: 'adc-client-smoke' },
    contextPayload: { title: 'ADC svc-workflow client smoke', smoke_run_id: runId },
  } as const;

  await client.assertSmokeReady();
  const created = await client.create(createInput, { idempotencyKey: createKey });
  const replayed = await client.create(createInput, { idempotencyKey: createKey });
  if (JSON.stringify(created) !== JSON.stringify(replayed)) {
    throw new Error('create idempotency replay did not return the original result');
  }

  const detail = await client.detail(created.workflowInstanceId);
  if (detail.visibility !== 'full') {
    throw new Error('smoke principal did not receive full workflow visibility');
  }

  const transitioned = await client.transition(
    created.workflowInstanceId,
    {
      transitionDefinitionId: fixture.transitionDefinitionId,
      expectedWorkflowStateVersion: created.workflowStateVersion,
    },
    { idempotencyKey: transitionKey },
  );
  const timeline = await client.timeline(created.workflowInstanceId, { limit: 100 });
  const sequences = timeline.items.map((item) => item.eventSequence);
  if (
    sequences.length < 2 ||
    sequences.some((value, index) => index > 0 && value <= sequences[index - 1])
  ) {
    throw new Error('workflow timeline event sequence is not strictly increasing');
  }

  console.info('[svc-workflow-client-smoke] PASS', {
    workflowInstanceId: created.workflowInstanceId,
    initialStateVersion: created.workflowStateVersion,
    finalStateVersion: transitioned.workflowStateVersion,
    eventCount: timeline.items.length,
  });
}

void main().catch((error: unknown) => {
  if (error instanceof WorkflowApiError) {
    console.error('[svc-workflow-client-smoke] FAIL', {
      kind: error.kind,
      operation: error.operation,
      status: error.status,
      code: error.code,
      attempts: error.attempts,
      upstreamRequestId: error.upstreamRequestId,
    });
  } else if (error instanceof WorkflowClientError) {
    console.error('[svc-workflow-client-smoke] FAIL', {
      kind: error.kind,
      operation: error.operation,
      attempts: error.attempts,
    });
  } else {
    console.error('[svc-workflow-client-smoke] FAIL', { kind: 'smoke_assertion' });
  }
  process.exitCode = 1;
});
