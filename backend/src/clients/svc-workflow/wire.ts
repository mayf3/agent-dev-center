import { z } from 'zod';
import type {
  ContextRevision,
  CreateWorkflowInstanceInput,
  CreateWorkflowInstanceResult,
  ExecuteWorkflowTransitionInput,
  ExecuteWorkflowTransitionResult,
  HistoricalParticipantSummary,
  JsonValue,
  NodeVisit,
  OutgoingTransition,
  PublicNodeSummary,
  WorkflowErrorEnvelope,
  WorkflowEvent,
  WorkflowInstanceDetail,
  WorkflowInstanceSummary,
  WorkflowTimelinePage,
  WorkflowTimelineQuery,
} from './contracts.js';

const uuidSchema = z.string().uuid();
const nullableUuidSchema = uuidSchema.nullable();

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const workflowInstanceIdSchema = uuidSchema;

export const createInputSchema: z.ZodType<CreateWorkflowInstanceInput> = z
  .object({
    domainId: uuidSchema,
    definitionVersionId: uuidSchema,
    externalReference: z
      .string()
      .refine((value) => [...value].length <= 512, 'must not exceed 512 Unicode characters')
      .optional(),
    externalUrl: z.string().optional(),
    metadata: jsonValueSchema,
    contextPayload: jsonValueSchema,
  })
  .strict();

export const transitionInputSchema: z.ZodType<ExecuteWorkflowTransitionInput> = z
  .object({
    transitionDefinitionId: uuidSchema,
    expectedWorkflowStateVersion: z.number().int(),
    submissionPayload: jsonValueSchema.optional(),
  })
  .strict();

export const timelineQuerySchema: z.ZodType<WorkflowTimelineQuery> = z
  .object({
    after: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const createResponseSchema = z
  .object({
    workflowInstanceId: uuidSchema,
    workflowStateVersion: z.number().int(),
    currentContextRevisionId: uuidSchema,
    currentNodeVisitId: uuidSchema,
    eventSequence: z.number().int(),
  })
  .strict();

const transitionResponseSchema = z
  .object({
    workflowInstanceId: uuidSchema,
    workflowStateVersion: z.number().int(),
    currentContextRevisionId: uuidSchema,
    sourceNodeVisitId: uuidSchema,
    currentNodeVisitId: uuidSchema,
    submissionId: nullableUuidSchema,
    eventSequence: z.number().int(),
  })
  .strict();

const versionResponseSchema = z
  .object({
    service: z.literal('svc-workflow'),
    version: z.string(),
    gitSha: z.string(),
    schemaVersion: z.literal('0010'),
    apiContractVersion: z.literal('internal-v0'),
  })
  .strict();

const readinessResponseSchema = z.object({ status: z.literal('ready') }).strict();

const publicNodeWireSchema = z
  .object({
    node_id: uuidSchema,
    node_key: z.string(),
    display_name: z.string(),
    node_type: z.string(),
  })
  .strict();

const workflowInstanceSummaryWireSchema = z
  .object({
    workflow_instance_id: uuidSchema,
    domain_id: uuidSchema,
    definition_version_id: uuidSchema,
    definition_version_status: z.string(),
    created_by_principal_id: uuidSchema,
    workflow_state_version: z.number().int(),
    external_reference: z.string().nullable(),
    external_url: z.string().nullable(),
    metadata: jsonValueSchema.nullable(),
    created_at: z.string(),
    domain_enabled: z.boolean(),
    is_terminal: z.boolean(),
    current_node: publicNodeWireSchema,
  })
  .strict();

const historicalSummaryWireSchema = z
  .object({
    workflow_instance_id: uuidSchema,
    domain_id: uuidSchema,
    definition_version_id: uuidSchema,
    definition_version_status: z.string(),
    workflow_state_version: z.number().int(),
    created_at: z.string(),
    domain_enabled: z.boolean(),
    is_terminal: z.boolean(),
    current_node: publicNodeWireSchema,
  })
  .strict();

const contextRevisionWireSchema = z
  .object({
    context_revision_id: uuidSchema,
    workflow_instance_id: uuidSchema,
    revision_number: z.number().int(),
    previous_revision_id: nullableUuidSchema,
    payload: jsonValueSchema,
    payload_digest: z.string(),
    created_by_principal_id: uuidSchema,
    created_at: z.string(),
  })
  .strict();

const nodeVisitWireSchema = z
  .object({
    node_visit_id: uuidSchema,
    workflow_instance_id: uuidSchema,
    node: publicNodeWireSchema,
    visit_number: z.number().int(),
    assignee_principal_id: nullableUuidSchema,
    entered_by_transition_id: nullableUuidSchema,
    instructions: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

const blockedReasonSchema = z.enum([
  'ACTOR_NOT_CURRENT_ASSIGNEE',
  'CURRENT_NODE_TERMINAL',
  'DEFINITION_VERSION_REVOKED',
  'DEFINITION_VERSION_DRAFT',
  'ADVANCE_NOT_PRIMARY',
  'TARGET_ASSIGNEE_UNAVAILABLE',
]);

const outgoingTransitionWireSchema = z
  .object({
    transition_id: uuidSchema,
    transition_key: z.string(),
    display_name: z.string(),
    transition_effect: z.string(),
    target_node: publicNodeWireSchema,
    submission_schema: jsonValueSchema.nullable(),
    executable_for_actor: z.boolean(),
    blocked_reason: blockedReasonSchema.nullable(),
  })
  .strict();

const fullDetailWireSchema = z
  .object({
    visibility: z.literal('full'),
    detail: z
      .object({
        instance: workflowInstanceSummaryWireSchema,
        current_context_revision_id: uuidSchema,
        current_node_visit_id: uuidSchema,
        current_context: contextRevisionWireSchema,
        current_visit: nodeVisitWireSchema,
        outgoing_transitions: z.array(outgoingTransitionWireSchema),
      })
      .strict(),
  })
  .strict();

const historicalDetailWireSchema = z
  .object({
    visibility: z.literal('historical_participant'),
    detail: z.object({ instance: historicalSummaryWireSchema }).strict(),
  })
  .strict();

const detailWireSchema = z.discriminatedUnion('visibility', [
  fullDetailWireSchema,
  historicalDetailWireSchema,
]);

const workflowEventWireSchema = z
  .object({
    event_id: uuidSchema,
    workflow_instance_id: uuidSchema,
    event_sequence: z.number().int(),
    event_schema_version: z.string(),
    command_id: nullableUuidSchema,
    causation_id: nullableUuidSchema,
    correlation_id: nullableUuidSchema,
    event_type: z.string(),
    transition_effect: z.string().nullable(),
    source_node_visit_id: nullableUuidSchema,
    target_node_visit_id: nullableUuidSchema,
    context_revision_id: nullableUuidSchema,
    submission_id: nullableUuidSchema,
    event_data: jsonValueSchema.nullable(),
    event_data_digest: z.string().nullable(),
    actor_principal_id: uuidSchema,
    from_node_id: nullableUuidSchema,
    to_node_id: nullableUuidSchema,
    old_workflow_state_version: z.number().int(),
    new_workflow_state_version: z.number().int(),
    created_at: z.string(),
  })
  .strict();

const timelineWireSchema = z
  .object({
    items: z.array(workflowEventWireSchema),
    nextCursor: z.number().int().nullable(),
  })
  .strict();

export const errorEnvelopeSchema: z.ZodType<WorkflowErrorEnvelope> = z
  .object({
    error: z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
        message: z.string(),
        details: jsonValueSchema.optional(),
      })
      .strict(),
  })
  .strict();

type PublicNodeWire = z.infer<typeof publicNodeWireSchema>;
type InstanceSummaryWire = z.infer<typeof workflowInstanceSummaryWireSchema>;
type HistoricalSummaryWire = z.infer<typeof historicalSummaryWireSchema>;
type ContextRevisionWire = z.infer<typeof contextRevisionWireSchema>;
type NodeVisitWire = z.infer<typeof nodeVisitWireSchema>;
type OutgoingTransitionWire = z.infer<typeof outgoingTransitionWireSchema>;
type WorkflowEventWire = z.infer<typeof workflowEventWireSchema>;

function mapNode(value: PublicNodeWire): PublicNodeSummary {
  return {
    nodeId: value.node_id,
    nodeKey: value.node_key,
    displayName: value.display_name,
    nodeType: value.node_type,
  };
}

function mapInstance(value: InstanceSummaryWire): WorkflowInstanceSummary {
  return {
    workflowInstanceId: value.workflow_instance_id,
    domainId: value.domain_id,
    definitionVersionId: value.definition_version_id,
    definitionVersionStatus: value.definition_version_status,
    createdByPrincipalId: value.created_by_principal_id,
    workflowStateVersion: value.workflow_state_version,
    externalReference: value.external_reference,
    externalUrl: value.external_url,
    metadata: value.metadata,
    createdAt: value.created_at,
    domainEnabled: value.domain_enabled,
    isTerminal: value.is_terminal,
    currentNode: mapNode(value.current_node),
  };
}

function mapHistorical(value: HistoricalSummaryWire): HistoricalParticipantSummary {
  return {
    workflowInstanceId: value.workflow_instance_id,
    domainId: value.domain_id,
    definitionVersionId: value.definition_version_id,
    definitionVersionStatus: value.definition_version_status,
    workflowStateVersion: value.workflow_state_version,
    createdAt: value.created_at,
    domainEnabled: value.domain_enabled,
    isTerminal: value.is_terminal,
    currentNode: mapNode(value.current_node),
  };
}

function mapContext(value: ContextRevisionWire): ContextRevision {
  return {
    contextRevisionId: value.context_revision_id,
    workflowInstanceId: value.workflow_instance_id,
    revisionNumber: value.revision_number,
    previousRevisionId: value.previous_revision_id,
    payload: value.payload,
    payloadDigest: value.payload_digest,
    createdByPrincipalId: value.created_by_principal_id,
    createdAt: value.created_at,
  };
}

function mapVisit(value: NodeVisitWire): NodeVisit {
  return {
    nodeVisitId: value.node_visit_id,
    workflowInstanceId: value.workflow_instance_id,
    node: mapNode(value.node),
    visitNumber: value.visit_number,
    assigneePrincipalId: value.assignee_principal_id,
    enteredByTransitionId: value.entered_by_transition_id,
    instructions: value.instructions,
    createdAt: value.created_at,
  };
}

function mapTransition(value: OutgoingTransitionWire): OutgoingTransition {
  return {
    transitionId: value.transition_id,
    transitionKey: value.transition_key,
    displayName: value.display_name,
    transitionEffect: value.transition_effect,
    targetNode: mapNode(value.target_node),
    submissionSchema: value.submission_schema,
    executableForActor: value.executable_for_actor,
    blockedReason: value.blocked_reason,
  };
}

function mapEvent(value: WorkflowEventWire): WorkflowEvent {
  return {
    eventId: value.event_id,
    workflowInstanceId: value.workflow_instance_id,
    eventSequence: value.event_sequence,
    eventSchemaVersion: value.event_schema_version,
    commandId: value.command_id,
    causationId: value.causation_id,
    correlationId: value.correlation_id,
    eventType: value.event_type,
    transitionEffect: value.transition_effect,
    sourceNodeVisitId: value.source_node_visit_id,
    targetNodeVisitId: value.target_node_visit_id,
    contextRevisionId: value.context_revision_id,
    submissionId: value.submission_id,
    eventData: value.event_data,
    eventDataDigest: value.event_data_digest,
    actorPrincipalId: value.actor_principal_id,
    fromNodeId: value.from_node_id,
    toNodeId: value.to_node_id,
    oldWorkflowStateVersion: value.old_workflow_state_version,
    newWorkflowStateVersion: value.new_workflow_state_version,
    createdAt: value.created_at,
  };
}

export function parseCreateResponse(value: unknown): CreateWorkflowInstanceResult {
  return createResponseSchema.parse(value);
}

export function parseTransitionResponse(value: unknown): ExecuteWorkflowTransitionResult {
  return transitionResponseSchema.parse(value);
}

export function parseVersionResponse(value: unknown): void {
  versionResponseSchema.parse(value);
}

export function parseReadinessResponse(value: unknown): void {
  readinessResponseSchema.parse(value);
}

export function parseDetailResponse(value: unknown): WorkflowInstanceDetail {
  const parsed = detailWireSchema.parse(value);
  if (parsed.visibility === 'historical_participant') {
    return {
      visibility: parsed.visibility,
      detail: { instance: mapHistorical(parsed.detail.instance) },
    };
  }
  return {
    visibility: parsed.visibility,
    detail: {
      instance: mapInstance(parsed.detail.instance),
      currentContextRevisionId: parsed.detail.current_context_revision_id,
      currentNodeVisitId: parsed.detail.current_node_visit_id,
      currentContext: mapContext(parsed.detail.current_context),
      currentVisit: mapVisit(parsed.detail.current_visit),
      outgoingTransitions: parsed.detail.outgoing_transitions.map(mapTransition),
    },
  };
}

export function parseTimelineResponse(value: unknown): WorkflowTimelinePage {
  const parsed = timelineWireSchema.parse(value);
  return { items: parsed.items.map(mapEvent), nextCursor: parsed.nextCursor };
}
