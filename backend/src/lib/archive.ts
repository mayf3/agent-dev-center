/**
 * Archive utility – every delete must go through here.
 *
 * Instead of permanently removing files or DB records, we move them to an
 * `archive/` directory (or mark them archived in the DB) so they can be
 * recovered later.
 *
 * Directory layout:
 *   archive/
 *     requirements/attachments/<requirementId>/<filename>
 *     marketplace/uploads/<filename>
 *     marketplace/deliverables/<id>.json
 *     tasks/<id>.json
 *     postmortems/<id>.json
 *     notifications/<id>.json
 *     reports/<id>.json
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync, renameSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Base archive directory – relative to CWD so it lives inside the project
const ARCHIVE_ROOT = path.resolve(process.cwd(), 'archive');

/** Ensure a directory exists (recursive) */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Get the path to a category-specific archive sub-directory */
export function getArchiveDir(category: string): string {
  const dir = path.join(ARCHIVE_ROOT, category);
  ensureDir(dir);
  return dir;
}

/** Append an entry to the archive README.md in the given category directory */
export function appendArchiveReadme(category: string, entry: ArchiveEntry): void {
  const dir = getArchiveDir(category);
  const readmePath = path.join(dir, 'README.md');

  const timestamp = new Date().toISOString();
  const lines = [
    `## ${entry.itemName}`,
    `- **Archived at**: ${timestamp}`,
    `- **Original ID**: ${entry.itemId}`,
    `- **Reason**: ${entry.reason}`,
    `- **Archived by**: ${entry.archivedBy}`,
    entry.extra ? `- **Details**: ${entry.extra}` : '',
    ''
  ].filter(Boolean).join('\n');

  if (!existsSync(readmePath)) {
    const header = `# Archive – ${category}\n\n> Auto-generated archive log. Items are moved here instead of being permanently deleted.\n\n`;
    writeFileSync(readmePath, header, 'utf-8');
  }

  // Append the entry
  const existing = readFileSync(readmePath, 'utf-8');
  writeFileSync(readmePath, existing + lines + '\n', 'utf-8');
}

export interface ArchiveEntry {
  /** Human-readable name of the archived item */
  itemName: string;
  /** Original ID or identifier */
  itemId: string;
  /** Why it was archived */
  reason: string;
  /** Who triggered the archive */
  archivedBy: string;
  /** Extra metadata (JSON string or text) */
  extra?: string;
}

/**
 * Archive a physical file by moving it to the archive directory.
 * Returns the destination path.
 */
export function archiveFile(
  filePath: string,
  category: string,
  entry: ArchiveEntry
): string {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const dir = getArchiveDir(category);
  const basename = path.basename(filePath);

  // Handle name collisions by appending timestamp
  let destPath = path.join(dir, basename);
  if (existsSync(destPath)) {
    const ext = path.extname(basename);
    const name = path.basename(basename, ext);
    destPath = path.join(dir, `${name}_${Date.now()}${ext}`);
  }

  renameSync(filePath, destPath);
  appendArchiveReadme(category, entry);

  return destPath;
}

/**
 * Archive a JSON record (DB row) by writing it to a JSON file in the archive.
 * Returns the destination path.
 */
export function archiveRecord(
  record: Record<string, unknown>,
  category: string,
  entry: ArchiveEntry
): string {
  const dir = getArchiveDir(category);
  const filename = `${entry.itemId}.json`;
  const destPath = path.join(dir, filename);

  const payload = {
    archivedAt: new Date().toISOString(),
    archivedBy: entry.archivedBy,
    reason: entry.reason,
    originalRecord: record
  };

  writeFileSync(destPath, JSON.stringify(payload, null, 2), 'utf-8');
  appendArchiveReadme(category, entry);

  return destPath;
}

/**
 * List all items in an archive category.
 */
export function listArchived(category: string): string[] {
  const dir = getArchiveDir(category);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f !== 'README.md');
}

/**
 * Check the archive root exists.
 */
export function ensureArchiveRoot(): void {
  ensureDir(ARCHIVE_ROOT);
  const rootReadme = path.join(ARCHIVE_ROOT, 'README.md');
  if (!existsSync(rootReadme)) {
    writeFileSync(
      rootReadme,
      `# Archive Directory\n\n> This directory contains archived (soft-deleted) items.\n> Every delete operation in the platform moves items here instead of permanently removing them.\n> **Do NOT manually delete items from this directory.**\n`,
      'utf-8'
    );
  }
}
