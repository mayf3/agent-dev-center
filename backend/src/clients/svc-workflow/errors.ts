import type { JsonValue, WorkflowOperation } from './contracts.js';

export type WorkflowClientErrorKind = 'configuration' | 'transport' | 'api' | 'protocol';

export abstract class WorkflowClientError extends Error {
  abstract readonly kind: WorkflowClientErrorKind;
  readonly operation?: WorkflowOperation;
  readonly attempts: number;

  protected constructor(message: string, operation?: WorkflowOperation, attempts = 0) {
    super(message);
    this.name = new.target.name;
    this.operation = operation;
    this.attempts = attempts;
  }
}

export class WorkflowConfigurationError extends WorkflowClientError {
  readonly kind = 'configuration' as const;

  constructor(message: string, operation?: WorkflowOperation) {
    super(message, operation);
  }
}

export class WorkflowTransportError extends WorkflowClientError {
  readonly kind = 'transport' as const;
  readonly transport: 'network' | 'timeout';

  constructor(
    operation: WorkflowOperation,
    transport: 'network' | 'timeout',
    attempts: number,
  ) {
    super(`svc-workflow ${transport} failure`, operation, attempts);
    this.transport = transport;
  }
}

export class WorkflowApiError extends WorkflowClientError {
  readonly kind = 'api' as const;
  readonly status: number;
  readonly code: string;
  readonly details?: JsonValue;
  readonly upstreamRequestId?: string;

  constructor(input: {
    operation: WorkflowOperation;
    attempts: number;
    status: number;
    code: string;
    message: string;
    details?: JsonValue;
    upstreamRequestId?: string;
  }) {
    super(input.message, input.operation, input.attempts);
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.upstreamRequestId = input.upstreamRequestId;
  }
}

export class WorkflowProtocolError extends WorkflowClientError {
  readonly kind = 'protocol' as const;
  readonly status?: number;
  readonly upstreamRequestId?: string;

  constructor(input: {
    operation: WorkflowOperation;
    attempts: number;
    status?: number;
    upstreamRequestId?: string;
  }) {
    super('svc-workflow returned an invalid response', input.operation, input.attempts);
    this.status = input.status;
    this.upstreamRequestId = input.upstreamRequestId;
  }
}
