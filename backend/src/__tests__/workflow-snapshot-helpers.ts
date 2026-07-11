/**
 * workflow-snapshot-helpers.ts
 *
 * Shared constants, fixtures, and pure utility functions for workflow
 * snapshot tests.
 *
 * NOTE: vi.mock() / vi.hoisted() must live in each test file because
 * vitest cannot export hoisted variables across modules.
 */
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// ── UUIDs ─────────────────────────────────────────────────

export const REQ_ID = '00000000-0000-0000-0000-000000000001';
export const DEV_USER_ID = '11111111-1111-1111-1111-111111111111';
export const QA_USER_ID = '22222222-2222-2222-2222-222222222222';
export const CTO_USER_ID = '33333333-3333-3333-3333-333333333333';
export const ADMIN_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ── Step Fixtures ─────────────────────────────────────────

export const STEPS = [
  { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false, assigneeMode: 'creator' },
  { name: 'dev_self_check', displayName: '开发自检', role: 'backend_developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'qa_review', displayName: 'QA审查', role: 'qa', requiredReports: [], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'done', displayName: '完成', role: 'admin', requiredReports: [], autoAdvance: false },
];

export const ROLE_USER_MAP: Record<string, string> = {
  backend_developer: DEV_USER_ID,
  qa: QA_USER_ID,
  admin: ADMIN_USER_ID,
};

export const SNAPSHOT_VALID = { steps: STEPS, roleUserMap: ROLE_USER_MAP };
export const SNAPSHOT_INVALID = { steps: 'not-an-array', roleUserMap: ROLE_USER_MAP };

// ── Test Users ────────────────────────────────────────────

export const DEV_USER: Record<string, unknown> = {
  id: DEV_USER_ID, name: 'Developer', email: 'dev@test.com',
  role: 'developer', internalRole: 'backend_developer',
};

export const QA_USER: Record<string, unknown> = {
  id: QA_USER_ID, name: 'QA User', email: 'qa@test.com',
  role: 'qa', internalRole: 'qa',
};

export const CTO_USER: Record<string, unknown> = {
  id: CTO_USER_ID, name: 'CTO', email: 'cto@test.com',
  role: 'cto_agent',
};

// ── Requirement Factory ───────────────────────────────────

export function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ_ID,
    title: 'Test Requirement',
    currentStep: 'qa_review',
    assigneeId: QA_USER_ID,
    assignee: 'QA User',
    requesterId: REQ_ID,
    requester: '需求提出者',
    workflowId: 'wf-1',
    workflow: { id: 'wf-1', steps: SNAPSHOT_VALID },
    stateVersion: 5,
    ...overrides,
  };
}

// ── HTTP Helper ───────────────────────────────────────────

export interface HttpResult { status: number; body: unknown; }

export async function httpPost(
  app: express.Express,
  path: string,
  bodyObj: Record<string, unknown>,
): Promise<HttpResult> {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.on('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const postData = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        server.close();
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode ?? 500, body: parsed });
      });
    });
    req.on('error', (err) => { server.close(); reject(err); });
    req.write(postData);
    req.end();
  });
}
