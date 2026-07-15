import type {
  CreateWorkflowInstanceInput,
  CreateWorkflowInstanceResult,
  ExecuteWorkflowTransitionInput,
  ExecuteWorkflowTransitionResult,
  WorkflowClientConfig,
  WorkflowClientDependencies,
  WorkflowClientLogEvent,
  WorkflowInstanceDetail,
  WorkflowOperation,
  WorkflowTimelinePage,
  WorkflowTimelineQuery,
  WriteOptions,
} from './contracts.js';
import {
  WorkflowApiError,
  WorkflowConfigurationError,
  WorkflowProtocolError,
  WorkflowTransportError,
} from './errors.js';
import {
  createInputSchema,
  errorEnvelopeSchema,
  parseCreateResponse,
  parseDetailResponse,
  parseReadinessResponse,
  parseTimelineResponse,
  parseTransitionResponse,
  parseVersionResponse,
  timelineQuerySchema,
  transitionInputSchema,
  workflowInstanceIdSchema,
} from './wire.js';

const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [250, 500] as const;

interface RequestSpec<T> {
  operation: WorkflowOperation;
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  idempotencyKey?: string;
  authenticated?: boolean;
  parseSuccess(value: unknown): T;
}

interface AttemptResponse {
  response: Response;
  text: string;
}

const defaultLogger = {
  log(event: WorkflowClientLogEvent): void {
    console.info('[svc-workflow-client]', JSON.stringify(event));
  },
};

export class WorkflowClient {
  private readonly baseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: NonNullable<WorkflowClientDependencies['fetch']>;
  private readonly sleep: NonNullable<WorkflowClientDependencies['sleep']>;
  private readonly logger: NonNullable<WorkflowClientDependencies['logger']>;

  constructor(
    private readonly config: WorkflowClientConfig,
    dependencies: WorkflowClientDependencies = {},
  ) {
    this.baseUrl = parseBaseUrl(config.baseUrl);
    this.requestTimeoutMs = positiveInteger(
      config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      'requestTimeoutMs',
    );
    this.maxAttempts = boundedAttempts(config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep =
      dependencies.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.logger = dependencies.logger ?? defaultLogger;
  }

  async assertSmokeReady(): Promise<void> {
    await this.request({
      operation: 'preflight',
      method: 'GET',
      path: '/version',
      authenticated: false,
      parseSuccess: parseVersionResponse,
    });
    await this.request({
      operation: 'preflight',
      method: 'GET',
      path: '/readyz',
      authenticated: false,
      parseSuccess: parseReadinessResponse,
    });
  }

  async create(
    input: CreateWorkflowInstanceInput,
    options: WriteOptions,
  ): Promise<CreateWorkflowInstanceResult> {
    const operation = 'create';
    const body = parseClientInput(operation, () => createInputSchema.parse(input));
    const idempotencyKey = validateIdempotencyKey(operation, options.idempotencyKey);
    return this.request({
      operation,
      method: 'POST',
      path: '/internal/v1/workflow-instances',
      body: serializeBody(operation, body),
      idempotencyKey,
      parseSuccess: parseCreateResponse,
    });
  }

  async detail(workflowInstanceId: string): Promise<WorkflowInstanceDetail> {
    const operation = 'detail';
    const id = parseClientInput(operation, () => workflowInstanceIdSchema.parse(workflowInstanceId));
    return this.request({
      operation,
      method: 'GET',
      path: `/internal/v1/workflow-instances/${encodeURIComponent(id)}`,
      parseSuccess: parseDetailResponse,
    });
  }

  async transition(
    workflowInstanceId: string,
    input: ExecuteWorkflowTransitionInput,
    options: WriteOptions,
  ): Promise<ExecuteWorkflowTransitionResult> {
    const operation = 'transition';
    const id = parseClientInput(operation, () => workflowInstanceIdSchema.parse(workflowInstanceId));
    const body = parseClientInput(operation, () => transitionInputSchema.parse(input));
    const idempotencyKey = validateIdempotencyKey(operation, options.idempotencyKey);
    return this.request({
      operation,
      method: 'POST',
      path: `/internal/v1/workflow-instances/${encodeURIComponent(id)}/transitions`,
      body: serializeBody(operation, body),
      idempotencyKey,
      parseSuccess: parseTransitionResponse,
    });
  }

  async timeline(
    workflowInstanceId: string,
    query: WorkflowTimelineQuery = {},
  ): Promise<WorkflowTimelinePage> {
    const operation = 'timeline';
    const id = parseClientInput(operation, () => workflowInstanceIdSchema.parse(workflowInstanceId));
    const parsedQuery = parseClientInput(operation, () => timelineQuerySchema.parse(query));
    const search = new URLSearchParams();
    if (parsedQuery.after !== undefined) search.set('after', String(parsedQuery.after));
    if (parsedQuery.limit !== undefined) search.set('limit', String(parsedQuery.limit));
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return this.request({
      operation,
      method: 'GET',
      path: `/internal/v1/workflow-instances/${encodeURIComponent(id)}/timeline${suffix}`,
      parseSuccess: parseTimelineResponse,
    });
  }

  private async request<T>(spec: RequestSpec<T>): Promise<T> {
    const token = spec.authenticated === false ? undefined : await this.resolveToken(spec.operation);
    const url = new URL(spec.path, this.baseUrl);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.idempotencyKey !== undefined) headers['Idempotency-Key'] = spec.idempotencyKey;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      let result: AttemptResponse;
      try {
        const response = await this.fetchImpl(url, {
          method: spec.method,
          headers,
          body: spec.body,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        result = { response, text: await response.text() };
      } catch (error) {
        const transport = transportKind(error);
        const retry = attempt < this.maxAttempts;
        this.log({
          event: 'svc_workflow_client_attempt',
          operation: spec.operation,
          attempt,
          durationMs: Date.now() - startedAt,
          outcome: retry ? 'retry' : 'failure',
          transportError: transport,
        });
        if (retry) {
          await this.retryDelay(attempt);
          continue;
        }
        throw new WorkflowTransportError(spec.operation, transport, attempt);
      }

      const { response, text } = result;
      const upstreamRequestId = safeRequestId(response.headers.get('x-request-id'));
      if (response.ok) {
        try {
          const parsed = spec.parseSuccess(parseJson(text));
          this.log({
            event: 'svc_workflow_client_attempt',
            operation: spec.operation,
            attempt,
            durationMs: Date.now() - startedAt,
            outcome: 'success',
            status: response.status,
            upstreamRequestId,
          });
          return parsed;
        } catch {
          this.log({
            event: 'svc_workflow_client_attempt',
            operation: spec.operation,
            attempt,
            durationMs: Date.now() - startedAt,
            outcome: 'failure',
            status: response.status,
            upstreamRequestId,
          });
          throw new WorkflowProtocolError({
            operation: spec.operation,
            attempts: attempt,
            status: response.status,
            upstreamRequestId,
          });
        }
      }

      const envelope = parseErrorEnvelope(text);
      const errorCode = envelope?.error.code;
      const retry =
        attempt < this.maxAttempts && isRetryableResponse(response.status, errorCode);
      this.log({
        event: 'svc_workflow_client_attempt',
        operation: spec.operation,
        attempt,
        durationMs: Date.now() - startedAt,
        outcome: retry ? 'retry' : 'failure',
        status: response.status,
        errorCode,
        upstreamRequestId,
      });
      if (retry) {
        await this.retryDelay(attempt);
        continue;
      }
      if (!envelope) {
        throw new WorkflowProtocolError({
          operation: spec.operation,
          attempts: attempt,
          status: response.status,
          upstreamRequestId,
        });
      }
      throw new WorkflowApiError({
        operation: spec.operation,
        attempts: attempt,
        status: response.status,
        code: envelope.error.code,
        message: envelope.error.message,
        details: envelope.error.details,
        upstreamRequestId,
      });
    }
    throw new WorkflowProtocolError({ operation: spec.operation, attempts: this.maxAttempts });
  }

  private async resolveToken(operation: WorkflowOperation): Promise<string> {
    let token: string;
    try {
      token = await this.config.accessTokenProvider();
    } catch {
      throw new WorkflowConfigurationError('svc-workflow access token provider failed', operation);
    }
    if (typeof token !== 'string' || token.length === 0 || /\s/.test(token)) {
      throw new WorkflowConfigurationError('svc-workflow access token is invalid', operation);
    }
    return token;
  }

  private async retryDelay(attempt: number): Promise<void> {
    const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
    await this.sleep(delay);
  }

  private log(event: WorkflowClientLogEvent): void {
    try {
      this.logger.log(event);
    } catch {
      // Observability must not change command transport semantics.
    }
  }
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkflowConfigurationError('SVC_WORKFLOW_BASE_URL is invalid');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new WorkflowConfigurationError('SVC_WORKFLOW_BASE_URL is invalid');
  }
  url.pathname = '/';
  return url;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new WorkflowConfigurationError(`${name} must be a positive integer`);
  }
  return value;
}

function boundedAttempts(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new WorkflowConfigurationError('maxAttempts must be an integer from 1 through 3');
  }
  return value;
}

function parseClientInput<T>(operation: WorkflowOperation, parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new WorkflowConfigurationError('svc-workflow client input is invalid', operation);
  }
}

function serializeBody(operation: WorkflowOperation, value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw new WorkflowConfigurationError('svc-workflow request body is not serializable', operation);
  }
}

function validateIdempotencyKey(operation: WorkflowOperation, value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    ![...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e;
    })
  ) {
    throw new WorkflowConfigurationError(
      'Idempotency-Key must be 1-128 visible ASCII characters',
      operation,
    );
  }
  return value;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function parseErrorEnvelope(text: string) {
  try {
    const parsed = errorEnvelopeSchema.safeParse(parseJson(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function isRetryableResponse(status: number, code?: string): boolean {
  return (
    status === 503 ||
    (status === 425 && code === 'command_still_processing') ||
    (status === 408 && code === 'request_timeout')
  );
}

function transportKind(error: unknown): 'network' | 'timeout' {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return 'timeout';
  }
  return 'network';
}

function safeRequestId(value: string | null): string | undefined {
  if (!value || value.length > 128 || !/^[\x21-\x7e]+$/.test(value)) return undefined;
  return value;
}
