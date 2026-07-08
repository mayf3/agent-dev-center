/**
 * Root Cause Candidate Aggregation Script
 *
 * Aggregates RequirementEventLedger GUARDRAIL_BLOCKED events into
 * RootCauseCandidate records.
 *
 * Usage:
 *   npx tsx src/scripts/aggregate-root-cause-candidates.ts
 *   npx tsx src/scripts/aggregate-root-cause-candidates.ts --window-hours 48 --dry-run
 *   npx tsx src/scripts/aggregate-root-cause-candidates.ts --limit 500
 */
import { PrismaClient } from '@prisma/client';
import {
  groupEvents,
  buildCandidateUpsert,
  shouldSkipExisting,
  ALLOWED_REASON_CODES,
} from '../lib/root-cause-candidate-aggregator.js';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  let windowHours = 24;
  let dryRun = false;
  let limit = 1000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--window-hours' && args[i + 1]) {
      windowHours = parseInt(args[i + 1], 10) || 24;
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10) || 1000;
      i++;
    }
  }

  return { windowHours, dryRun, limit };
}

async function main() {
  const { windowHours, dryRun, limit } = parseArgs();
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  console.log(`[RootCauseCandidate] window=${windowHours}h since=${since.toISOString()} limit=${limit} dryRun=${dryRun}`);

  // Fetch relevant ledger events with requirement + workflow join
  const events = await prisma.requirementEventLedger.findMany({
    where: {
      eventType: 'GUARDRAIL_BLOCKED',
      createdAt: { gte: since },
      reasonCode: { in: [...ALLOWED_REASON_CODES] },
    },
    include: {
      requirement: {
        select: {
          workflowId: true,
          workflow: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  console.log(`[RootCauseCandidate] fetched ${events.length} guardrail events`);

  if (events.length === 0) {
    console.log('[RootCauseCandidate] no events to process');
    await prisma.$disconnect();
    return;
  }

  // Group by fingerprint
  const groups = groupEvents(events as any);
  console.log(`[RootCauseCandidate] grouped into ${groups.size} candidates`);

  if (dryRun) {
    console.log('\n[Dry-Run] Candidates to upsert:');
    for (const [, group] of groups) {
      const upsert = buildCandidateUpsert(group, windowHours);
      console.log(JSON.stringify({
        fingerprint: upsert.fingerprint,
        rootCauseType: upsert.rootCauseType,
        title: upsert.title,
        severity: upsert.severity,
        reasonCode: upsert.reasonCode,
        workflowName: upsert.workflowName,
        affectedRequirementCount: upsert.affectedRequirementCount,
        sampleRequirementIds: upsert.sampleRequirementIds,
        evidenceEventCount: upsert.evidenceEventIds.length,
        metadata: upsert.metadata,
      }, null, 2));
    }
    console.log(`\n[Dry-Run] Total ${groups.size} candidates would be upserted`);
  } else {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const [, group] of groups) {
      const upsert = buildCandidateUpsert(group, windowHours);

      // Check existing candidate by fingerprint
      const existing = await prisma.rootCauseCandidate.findUnique({
        where: { fingerprint: upsert.fingerprint },
        select: { id: true, status: true },
      });

      if (existing && shouldSkipExisting(existing.status)) {
        skipped++;
        continue;
      }

      if (existing) {
        await prisma.rootCauseCandidate.update({
          where: { id: existing.id },
          data: {
            affectedRequirementCount: upsert.affectedRequirementCount,
            sampleRequirementIds: upsert.sampleRequirementIds as any,
            evidenceEventIds: upsert.evidenceEventIds as any,
            firstSeenAt: upsert.firstSeenAt,
            lastSeenAt: upsert.lastSeenAt,
            metadata: upsert.metadata as any,
            severity: upsert.severity,
            description: upsert.description,
            updatedAt: new Date(),
          },
        });
        updated++;
      } else {
        await prisma.rootCauseCandidate.create({
          data: {
            fingerprint: upsert.fingerprint,
            workflowId: upsert.workflowId,
            workflowName: upsert.workflowName,
            rootCauseType: upsert.rootCauseType,
            title: upsert.title,
            description: upsert.description,
            severity: upsert.severity,
            status: 'open',
            reasonCode: upsert.reasonCode,
            eventType: upsert.eventType,
            affectedRequirementCount: upsert.affectedRequirementCount,
            sampleRequirementIds: upsert.sampleRequirementIds as any,
            evidenceEventIds: upsert.evidenceEventIds as any,
            firstSeenAt: upsert.firstSeenAt,
            lastSeenAt: upsert.lastSeenAt,
            metadata: upsert.metadata as any,
          },
        });
        created++;
      }
    }

    console.log(`[RootCauseCandidate] created=${created} updated=${updated} skipped=${skipped}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[RootCauseCandidate] error:', err);
  process.exit(1);
});
