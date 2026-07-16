export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowOperation = 'preflight' | 'create' | 'detail' | 'transition' | 'timeline';

export type AccessTokenProvider = () => string | Promise<string>;

export interface WorkflowClientConfig {
  baseUrl: string;
  accessTokenProvider: AccessTokenProvider;
  requestTimeoutMs?: number;
  maxAttempts?: number;
}

export interface WorkflowClientLogEvent {
  event: 'svc_workflow_client_attempt';
  operation: WorkflowOperation;
  attempt: number;
  durationMs: number;
  outcome: 'success' | 'retry' | 'failure';
  status?: number;
  errorCode?: string;
  upstreamRequestId?: string;
  transportError?: 'network' | 'timeout';
}

export interface WorkflowClientLogger {
  log(event: WorkflowClientLogEvent): void;
}

export interface WorkflowClientDependencies {
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  sleep?: (delayMs: number) => Promise<void>;
  logger?: WorkflowClientLogger;
}

export interface WriteOptions {
  idempotencyKey: string;
}

export interface CreateWorkflowInstanceInput {
  domainId: string;
  definitionVersionId: string;
  externalReference?: string;
  externalUrl?: string;
  metadata: JsonValue;
  contextPayload: JsonValue;
}

export interface CreateWorkflowInstanceResult {
  workflowInstanceId: string;
  workflowStateVersion: number;
  currentContextRevisionId: string;
  currentNodeVisitId: string;
  eventSequence: number;
}

export interface ExecuteWorkflowTransitionInput {
  transitionDefinitionId: string;
  expectedWorkflowStateVersion: number;
  submissionPayload?: JsonValue;
}

export interface ExecuteWorkflowTransitionResult {
  workflowInstanceId: string;
  workflowStateVersion: number;
  currentContextRevisionId: string;
  sourceNodeVisitId: string;
  currentNodeVisitId: string;
  submissionId: string | null;
  eventSequence: number;
}

export interface PublicNodeSummary {
  nodeId: string;
  nodeKey: string;
  displayName: string;
  nodeType: string;
}

export interface WorkflowInstanceSummary {
  workflowInstanceId: string;
  domainId: string;
  definitionVersionId: string;
  definitionVersionStatus: string;
  createdByPrincipalId: string;
  workflowStateVersion: number;
  externalReference: string | null;
  externalUrl: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  domainEnabled: boolean;
  isTerminal: boolean;
  currentNode: PublicNodeSummary;
}

export interface HistoricalParticipantSummary {
  workflowInstanceId: string;
  domainId: string;
  definitionVersionId: string;
  definitionVersionStatus: string;
  workflowStateVersion: number;
  createdAt: string;
  domainEnabled: boolean;
  isTerminal: boolean;
  currentNode: PublicNodeSummary;
}

export interface ContextRevision {
  contextRevisionId: string;
  workflowInstanceId: string;
  revisionNumber: number;
  previousRevisionId: string | null;
  payload: JsonValue;
  payloadDigest: string;
  createdByPrincipalId: string;
  createdAt: string;
}

export interface NodeVisit {
  nodeVisitId: string;
  workflowInstanceId: string;
  node: PublicNodeSummary;
  visitNumber: number;
  assigneePrincipalId: string | null;
  enteredByTransitionId: string | null;
  instructions: string | null;
  createdAt: string;
}

export type TransitionBlockedReason =
  | 'ACTOR_NOT_CURRENT_ASSIGNEE'
  | 'CURRENT_NODE_TERMINAL'
  | 'DEFINITION_VERSION_REVOKED'
  | 'DEFINITION_VERSION_DRAFT'
  | 'ADVANCE_NOT_PRIMARY'
  | 'TARGET_ASSIGNEE_UNAVAILABLE';

export interface OutgoingTransition {
  transitionId: string;
  transitionKey: string;
  displayName: string;
  transitionEffect: string;
  targetNode: PublicNodeSummary;
  submissionSchema: JsonValue | null;
  executableForActor: boolean;
  blockedReason: TransitionBlockedReason | null;
}

export type WorkflowInstanceDetail =
  | {
      visibility: 'full';
      detail: {
        instance: WorkflowInstanceSummary;
        currentContextRevisionId: string;
        currentNodeVisitId: string;
        currentContext: ContextRevision;
        currentVisit: NodeVisit;
        outgoingTransitions: OutgoingTransition[];
      };
    }
  | {
      visibility: 'historical_participant';
      detail: { instance: HistoricalParticipantSummary };
    };

export interface WorkflowEvent {
  eventId: string;
  workflowInstanceId: string;
  eventSequence: number;
  eventSchemaVersion: string;
  commandId: string | null;
  causationId: string | null;
  correlationId: string | null;
  eventType: string;
  transitionEffect: string | null;
  sourceNodeVisitId: string | null;
  targetNodeVisitId: string | null;
  contextRevisionId: string | null;
  submissionId: string | null;
  eventData: JsonValue | null;
  eventDataDigest: string | null;
  actorPrincipalId: string;
  fromNodeId: string | null;
  toNodeId: string | null;
  oldWorkflowStateVersion: number;
  newWorkflowStateVersion: number;
  createdAt: string;
}

export interface WorkflowTimelineQuery {
  after?: number;
  limit?: number;
}

export interface WorkflowTimelinePage {
  items: WorkflowEvent[];
  nextCursor: number | null;
}

export interface WorkflowErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: JsonValue;
  };
}
