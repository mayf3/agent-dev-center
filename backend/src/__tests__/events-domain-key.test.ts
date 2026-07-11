/**
 * Focused test for the events-route domainKey authorization fix.
 *
 * Background: the GET /:id/events handler in routes/requirements/events.ts
 * queries the Requirement with an explicit `select` and then calls
 * canReadRequirement(). On the audit-ledger mainline, canReadRequirement()
 * applies the domain-scope gate via tryDomainCheck(), which compares the
 * user's allowedDomainKeys against the requirement's real domainKey.
 *
 * Before the fix, events.ts omitted `domainKey` from the select, so the
 * requirement surfaced to canReadRequirement() had domainKey === undefined,
 * causing legitimate domain users to be wrongly rejected with 403 once the
 * domain-scope middleware was active.
 *
 * These tests exercise the REAL route + helper (not string grep):
 *  1. the Requirement query select includes domainKey: true
 *     (authoritative guard — catches the missing-select regression);
 *  2. an authorized domain user (real domainKey ∈ allowedDomainKeys) reads OK;
 *  3. an unauthorized domain user is still rejected 403 by tryDomainCheck().
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const UUID = '00000000-0000-0000-0000-000000000001';
const DOMAIN_OWNED = 'domain-owned';
const DOMAIN_OTHER = 'domain-other';

const { mockFindUnique, mockLedgerFindMany } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLedgerFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: {
      findUnique: mockFindUnique,
    },
    requirementEventLedger: { findMany: mockLedgerFindMany },
  },
}));

describe('events route domainKey authorization', () => {
  let registerEventRoutes: any;

  beforeAll(async () => {
    const mod = await vi.importActual<typeof import('../routes/requirements/events.js')>(
      '../routes/requirements/events.js',
    );
    registerEventRoutes = mod.registerEventRoutes;
  });

  beforeEach(() => { vi.clearAllMocks(); });

  /** Build an app with a user whose domain scope mirrors the middleware. */
  function createApp(user: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    // Emulate the domain-scope middleware attaching allowedDomainKeys /
    // crossDomainAccess to req.user at runtime (typed via `as any`).
    app.use((req: any, _res: any, next: any) => {
      req.user = user as any;
      next();
    });
    const router = express.Router();
    registerEventRoutes(router);
    app.use('/api/requirements', router);
    return app;
  }

  /**
   * Requirement fixture as it would be returned by the Prisma select.
   * The user is the assignee, so a `developer` passes the legacy role check —
   * making the domain gate the decisive factor exercised by these tests.
   */
  function requirementWith(domainKey: string | null, assigneeId = 'u1') {
    return {
      id: UUID,
      requesterId: null,
      requester: 'R',
      assigneeId,
      assignee: 'Dev',
      domainKey,
    };
  }

  async function boot(app: express.Express) {
    const sv = http.createServer(app);
    await new Promise<void>((r) => sv.listen(0, r));
    const port = (sv.address() as AddressInfo).port;
    return { sv, port };
  }

  it('selects domainKey when loading the requirement for authorization', async () => {
    mockFindUnique.mockResolvedValue(requirementWith(DOMAIN_OWNED, 'u1'));
    mockLedgerFindMany.mockResolvedValue([]);

    const { sv, port } = await boot(
      createApp({
        id: 'u1',
        name: 'Dev',
        email: 'dev@t.local',
        role: 'developer',
        // domain-scope middleware active: user can read DOMAIN_OWNED.
        allowedDomainKeys: [DOMAIN_OWNED],
        crossDomainAccess: false,
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/events`);
    sv.close();

    expect(res.status).toBe(200);
    // The REAL route's requirement query must request domainKey so the
    // domain gate sees the true value instead of undefined.
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockFindUnique.mock.calls[0][0].select).toEqual(
      expect.objectContaining({ domainKey: true }),
    );
  });

  it('lets a domain member whose domainKey matches read the event stream', async () => {
    mockFindUnique.mockResolvedValue(requirementWith(DOMAIN_OWNED, 'u2'));
    mockLedgerFindMany.mockResolvedValue([
      { id: 'e1', requirementId: UUID, eventType: 'WFA', createdAt: new Date(), metadata: {} },
    ]);

    const { sv, port } = await boot(
      createApp({
        id: 'u2',
        name: 'Dev',
        email: 'dev@t.local',
        role: 'developer',
        allowedDomainKeys: [DOMAIN_OWNED],
        crossDomainAccess: false,
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/events`);
    const body = await res.json();
    sv.close();

    // Positive path: a developer who is the assignee AND whose domainKey
    // matches can read the event stream. (The authoritative guard that the
    // route actually queries domainKey is the `select` assertion above; this
    // case confirms the end-to-end read succeeds once authorization passes.)
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it('still rejects a user whose allowedDomainKeys do not include the requirement domainKey', async () => {
    // The unauthorized user is also the assignee, so this proves the rejection
    // comes from the DOMAIN gate, not the legacy role check.
    mockFindUnique.mockResolvedValue(requirementWith(DOMAIN_OWNED, 'u3'));
    mockLedgerFindMany.mockResolvedValue([]);

    const { sv, port } = await boot(
      createApp({
        id: 'u3',
        name: 'Other',
        email: 'other@t.local',
        role: 'developer',
        // Domain scope active, but user belongs to a DIFFERENT domain.
        allowedDomainKeys: [DOMAIN_OTHER],
        crossDomainAccess: false,
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/requirements/${UUID}/events`);
    sv.close();

    expect(res.status).toBe(403);
    // The unauthorized user must never reach the ledger query.
    expect(mockLedgerFindMany).not.toHaveBeenCalled();
  });
});
