import { describe, expect, it } from 'vitest';
import {
  createInputSchema,
  parseDetailResponse,
  parseTimelineResponse,
  timelineQuerySchema,
} from './wire.js';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const DOMAIN_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const PRINCIPAL_ID = '44444444-4444-4444-8444-444444444444';
const CONTEXT_ID = '55555555-5555-4555-8555-555555555555';
const VISIT_ID = '66666666-6666-4666-8666-666666666666';
const NODE_ID = '77777777-7777-4777-8777-777777777777';
const TRANSITION_ID = '88888888-8888-4888-8888-888888888888';
const EVENT_ID = '99999999-9999-4999-8999-999999999999';

const node = {
  node_id: NODE_ID,
  node_key: 'draft',
  display_name: 'Draft',
  node_type: 'DRAFT',
};

describe('svc-workflow wire contract', () => {
  it('maps full detail structural fields to camelCase without rewriting opaque JSON', () => {
    const opaqueMetadata = { keep_snake_key: { nested_snake_key: true } };
    const opaqueContext = { business_snake_key: ['unchanged'] };
    const opaqueSubmissionSchema = { required_fields: ['report_uri'] };
    const detail = parseDetailResponse({
      visibility: 'full',
      detail: {
        instance: {
          workflow_instance_id: INSTANCE_ID,
          domain_id: DOMAIN_ID,
          definition_version_id: DEFINITION_ID,
          definition_version_status: 'PUBLISHED',
          created_by_principal_id: PRINCIPAL_ID,
          workflow_state_version: 1,
          external_reference: 'adc-1',
          external_url: null,
          metadata: opaqueMetadata,
          created_at: '2026-07-16T00:00:00Z',
          domain_enabled: true,
          is_terminal: false,
          current_node: node,
        },
        current_context_revision_id: CONTEXT_ID,
        current_node_visit_id: VISIT_ID,
        current_context: {
          context_revision_id: CONTEXT_ID,
          workflow_instance_id: INSTANCE_ID,
          revision_number: 1,
          previous_revision_id: null,
          payload: opaqueContext,
          payload_digest: 'context-digest',
          created_by_principal_id: PRINCIPAL_ID,
          created_at: '2026-07-16T00:00:00Z',
        },
        current_visit: {
          node_visit_id: VISIT_ID,
          workflow_instance_id: INSTANCE_ID,
          node,
          visit_number: 1,
          assignee_principal_id: PRINCIPAL_ID,
          entered_by_transition_id: null,
          instructions: null,
          created_at: '2026-07-16T00:00:00Z',
        },
        outgoing_transitions: [
          {
            transition_id: TRANSITION_ID,
            transition_key: 'advance',
            display_name: 'Advance',
            transition_effect: 'ADVANCE',
            target_node: { ...node, node_key: 'done', node_type: 'TERMINAL' },
            submission_schema: opaqueSubmissionSchema,
            executable_for_actor: true,
            blocked_reason: null,
          },
        ],
      },
    });

    expect(detail.visibility).toBe('full');
    if (detail.visibility !== 'full') throw new Error('expected full detail');
    expect(detail.detail.currentContextRevisionId).toBe(CONTEXT_ID);
    expect(detail.detail.instance.currentNode.nodeKey).toBe('draft');
    expect(detail.detail.instance.metadata).toEqual(opaqueMetadata);
    expect(detail.detail.currentContext.payload).toEqual(opaqueContext);
    expect(detail.detail.outgoingTransitions[0].submissionSchema).toEqual(opaqueSubmissionSchema);
    expect(detail.detail).not.toHaveProperty('current_context_revision_id');
  });

  it('maps timeline item fields while preserving eventData keys', () => {
    const eventData = { return_reason: { review_code: 'needs_work' } };
    const timeline = parseTimelineResponse({
      items: [
        {
          event_id: EVENT_ID,
          workflow_instance_id: INSTANCE_ID,
          event_sequence: 2,
          event_schema_version: 'v1',
          command_id: null,
          causation_id: null,
          correlation_id: null,
          event_type: 'WORKFLOW_TRANSITIONED',
          transition_effect: 'ADVANCE',
          source_node_visit_id: VISIT_ID,
          target_node_visit_id: null,
          context_revision_id: CONTEXT_ID,
          submission_id: null,
          event_data: eventData,
          event_data_digest: 'event-digest',
          actor_principal_id: PRINCIPAL_ID,
          from_node_id: NODE_ID,
          to_node_id: null,
          old_workflow_state_version: 1,
          new_workflow_state_version: 2,
          created_at: '2026-07-16T00:00:01Z',
        },
      ],
      nextCursor: 2,
    });

    expect(timeline.nextCursor).toBe(2);
    expect(timeline.items[0]).toMatchObject({
      eventId: EVENT_ID,
      workflowInstanceId: INSTANCE_ID,
      eventSequence: 2,
      oldWorkflowStateVersion: 1,
      newWorkflowStateVersion: 2,
    });
    expect(timeline.items[0].eventData).toEqual(eventData);
  });

  it('enforces strict actor-free inputs and Unicode character limits', () => {
    const input = {
      domainId: DOMAIN_ID,
      definitionVersionId: DEFINITION_ID,
      metadata: {},
      contextPayload: {},
    };
    expect(createInputSchema.safeParse({ ...input, principalId: PRINCIPAL_ID }).success).toBe(false);
    expect(createInputSchema.safeParse({ ...input, externalReference: '😀'.repeat(512) }).success).toBe(true);
    expect(createInputSchema.safeParse({ ...input, externalReference: '😀'.repeat(513) }).success).toBe(false);
  });

  it('validates timeline keyset pagination at the client boundary', () => {
    expect(timelineQuerySchema.safeParse({ after: 0, limit: 100 }).success).toBe(true);
    expect(timelineQuerySchema.safeParse({ after: -1 }).success).toBe(false);
    expect(timelineQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(timelineQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
