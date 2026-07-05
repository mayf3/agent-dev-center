/**
 * CLI entry point for Agent Todo Efficiency Cutover Tool.
 *
 * Parses arguments, resolves PrismaClient, dispatches to the correct
 * service operation, formats output, and handles errors uniformly.
 */

import { PrismaClient } from '@prisma/client';
import { parseCliArgs } from './validation.js';
import { resolveDatabaseUrl } from './validators.js';
import {
  executeDryRun,
  executeApply,
  executeRollback,
} from './service.js';
import {
  formatDryRunOutput,
  formatApplyOutput,
  formatRollbackOutput,
  formatHelp,
} from './evidence.js';
import type { CliArgs } from './types.js';

export interface CliResult {
  exitCode: number;
  output: string;
  summary?: Record<string, unknown>;
}

/**
 * Main CLI handler.
 * @param argv - process.argv or test stub
 */
export async function runCli(argv: string[]): Promise<CliResult> {
  // Strip node/binary entries
  const args = argv.slice(2);

  // Help flag
  if (args.includes('--help') || args.includes('-h')) {
    return { exitCode: 0, output: formatHelp() };
  }

  // Parse and validate arguments
  const parsed = parseCliArgs(args);
  if (!parsed.ok || !parsed.args) {
    return {
      exitCode: 1,
      output: [
        '❌ 参数错误:',
        ...parsed.errors.map(e => `  - ${e}`),
        '',
        '使用 --help 查看帮助',
      ].join('\n'),
    };
  }

  const cliArgs: CliArgs = parsed.args;

  // Resolve DATABASE_URL (validation happens inside service layer)
  let prisma: PrismaClient;
  try {
    const { url, source } = resolveDatabaseUrl(cliArgs);
    console.error(`ℹ️  数据库连接来源: ${source}`);
    prisma = new PrismaClient({
      datasources: { db: { url } },
    });
    await prisma.$connect();
  } catch (err) {
    return {
      exitCode: 1,
      output: `❌ 数据库连接失败: ${(err as Error).message}`,
    };
  }

  try {
    switch (cliArgs.mode) {
      case 'dry-run': {
        const summary = await executeDryRun(prisma, cliArgs);
        return {
          exitCode: 0,
          output: formatDryRunOutput(summary),
          summary: summary as unknown as Record<string, unknown>,
        };
      }

      case 'apply': {
        const summary = await executeApply(prisma, cliArgs);
        return {
          exitCode: 0,
          output: formatApplyOutput(summary),
          summary: summary as unknown as Record<string, unknown>,
        };
      }

      case 'rollback': {
        const summary = await executeRollback(prisma, cliArgs);
        return {
          exitCode: 0,
          output: formatRollbackOutput(summary),
          summary: summary as unknown as Record<string, unknown>,
        };
      }

      default:
        return { exitCode: 1, output: `未知模式: ${cliArgs.mode}` };
    }
  } catch (err) {
    const message = (err as Error).message;
    return {
      exitCode: 1,
      output: `❌ 操作失败: ${message}`,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Direct execution ─────────────────────────────────────────────────────

if (require.main === module) {
  runCli(process.argv).then((result) => {
    console.log(result.output);
    process.exit(result.exitCode);
  }).catch((err) => {
    console.error('未捕获的异常:', err);
    process.exit(1);
  });
}
