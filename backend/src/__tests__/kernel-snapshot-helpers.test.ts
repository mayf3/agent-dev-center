/**
 * Kernel Phase 2A — Snapshot Helper Unit Tests
 */
import { describe, test, expect } from 'vitest';
import {
  getWorkflowSteps,
  getWorkflowRoleUserMap,
} from '../routes/requirements/workflow-helpers.js';

// ── getWorkflowSteps ──────────────────────────────────────

describe('getWorkflowSteps', () => {
  const arraySteps = [
    { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
    { name: 'dev', displayName: '开发', role: 'developer', requiredReports: [], autoAdvance: false },
  ];
  const objectSteps = {
    steps: [
      { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
    ],
    roleUserMap: { developer: 'user-1' },
  };

  test('数组 snapshot 正常读取', () => {
    const result = getWorkflowSteps(arraySteps);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('draft');
    expect(result[1].name).toBe('dev');
  });

  test('对象 snapshot steps 数组正常读取', () => {
    const result = getWorkflowSteps(objectSteps);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('draft');
  });

  test('对象 snapshot 无 steps 字段报错', () => {
    expect(() => getWorkflowSteps({ foo: 'bar' })).toThrow('缺少 steps 字段');
  });

  test('对象 snapshot steps 不是数组报错', () => {
    expect(() => getWorkflowSteps({ steps: 'not-an-array' })).toThrow('steps 不是数组');
  });

  test('字符串 snapshot 报错', () => {
    expect(() => getWorkflowSteps('just a string')).toThrow('格式无效');
  });

  test('数字 snapshot 报错', () => {
    expect(() => getWorkflowSteps(42)).toThrow('格式无效');
  });

  test('布尔 snapshot 报错', () => {
    expect(() => getWorkflowSteps(true)).toThrow('格式无效');
  });

  test('null snapshot 报错', () => {
    expect(() => getWorkflowSteps(null)).toThrow('格式无效');
  });
});

// ── getWorkflowRoleUserMap ────────────────────────────────

describe('getWorkflowRoleUserMap', () => {
  test('数组 snapshot 返回空映射', () => {
    const result = getWorkflowRoleUserMap([{ name: 'draft', role: 'requester' }]);
    expect(result).toEqual({});
  });

  test('对象 snapshot roleUserMap 正常读取', () => {
    const result = getWorkflowRoleUserMap({
      steps: [],
      roleUserMap: { developer: 'user-1' },
    });
    expect(result).toEqual({ developer: 'user-1' });
  });

  test('roleUserMap 缺失返回空映射', () => {
    const result = getWorkflowRoleUserMap({ steps: [] });
    expect(result).toEqual({});
  });

  test('roleUserMap 为 null 返回空映射', () => {
    const result = getWorkflowRoleUserMap({ steps: [], roleUserMap: null });
    expect(result).toEqual({});
  });

  test('roleUserMap 为字符串报错', () => {
    expect(() => getWorkflowRoleUserMap({ steps: [], roleUserMap: 'bad' })).toThrow('roleUserMap 类型无效');
  });

  test('roleUserMap 为数组报错', () => {
    expect(() => getWorkflowRoleUserMap({ steps: [], roleUserMap: [] })).toThrow('roleUserMap 类型无效');
  });

  test('null/undefined rawJson 返回空映射', () => {
    expect(getWorkflowRoleUserMap(null)).toEqual({});
    expect(getWorkflowRoleUserMap(undefined)).toEqual({});
  });
});
