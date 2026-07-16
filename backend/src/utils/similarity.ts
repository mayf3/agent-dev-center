/**
 * 文本相似度工具 — 需求重复检测
 *
 * 使用 Levenshtein 距离计算相似度，轻量无依赖。
 */

/**
 * 计算 Levenshtein 编辑距离
 */
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // 优化：只用两行
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let curr = new Array(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const ac = a[i - 1];
    for (let j = 1; j <= lb; j++) {
      const cost = ac === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,     // insert
        prev[j] + 1,         // delete
        prev[j - 1] + cost,  // replace
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[lb];
}

/**
 * 计算两个字符串的相似度（0~1）
 * 1 = 完全相同，0 = 完全不同
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

/**
 * 标准化标题用于比对（小写、去空格、去标点）
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\-_—–]+/g, '')
    .replace(/[^\w\u4e00-\u9fff]/g, '');
}

/**
 * 默认相似度阈值
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.8;
