/**
 * Default Workflow Templates
 *
 * 应用启动时自动 upsert，确保每个环境都有标准工作流模板。
 * 如需新增模板，在此文件添加即可。
 *
 * 2026-06-10 v3: 工作流链路重构
 *   核心原则：每一步只要求「前一步交付的东西」
 *   - QA 是全链路质检员：开发自检→QA审、测试→QA审、安全→QA审、部署→QA验证
 *   - CTO 只看 QA 结论（QA 已过滤）
 *   - checkReportsApproved 只认 status='approved'（不再接受 pending）
 *   - 新增 qa_review_security（QA 审查安全报告）和 qa_review_deploy（QA 验证部署）
 *
 * 2026-06-05: 所有开发类模板增加 pm_review（第1步）和 qa_review（dev_self_check 后）
 */
import { prisma } from './prisma.js';

interface StepDef {
  name: string;
  displayName: string;
  role: string;
  requiredReports: string[];
  autoAdvance: boolean;
}

interface TemplateDef {
  name: string;
  displayName: string;
  description: string;
  steps: StepDef[];
}

// ── 通用步骤块 ─────────────────────────────────────────

/** PM 审批步骤 — 所有开发类需求第一步 */
const PM_REVIEW: StepDef = {
  name: 'pm_review',
  displayName: 'PM审批',
  role: 'pm',
  requiredReports: [],
  autoAdvance: false,
};

/** QA 审查 DEV_SELF_CHECK 报告 — 门禁：开发自检报告必须已通过 */
const QA_REVIEW_DEV: StepDef = {
  name: 'qa_review',
  displayName: 'QA审查(开发自检)',
  role: 'qa',
  requiredReports: ['DEV_SELF_CHECK'],
  autoAdvance: false,
};

/**
 * 标准开发中段（v3 链路）：
 *
 * 链路逻辑（每步只要求前一步的产出）：
 *
 * test_env_deploy  — 门禁：DEV_SELF_CHECK approved（QA 已审过）
 *   → 部署测试环境
 *
 * testing          — 门禁：无（测试人员写报告）
 *   → 产出 TEST_REPORT
 *
 * qa_review_test   — 门禁：无（QA 审批 TEST_REPORT）
 *   → 审批 TEST_REPORT
 *
 * security_review  — 门禁：TEST_REPORT approved（QA 已审过）
 *   → 产出 SECURITY_REVIEW（非 SECURITY 类型自动跳过）
 *
 * qa_review_security — 门禁：无（QA 审批 SECURITY_REVIEW）
 *   → 审批 SECURITY_REVIEW（非 SECURITY 类型自动跳过）
 *
 * cto_review       — 门禁：TEST_REPORT approved + SECURITY_REVIEW approved（如适用）
 *   → CTO 看 QA 审查结论 + 自己的判断
 *   → 产出 CTO_REVIEW
 *
 * deploying        — 门禁：CTO_REVIEW approved
 *   → itops 实际部署
 *
 * qa_review_deploy — 门禁：无（QA 验证部署）
 *   → QA curl health check 验证
 *   → 审批 DEPLOY_CONFIRM
 *
 * done             — 门禁：DEPLOY_CONFIRM approved
 */

/** Merge-to-main 步骤：代码合并到 main 后验证。role 取上游 dev_self_check 的角色 */
const mergeToMain = (role: string): StepDef => ({
  name: 'merge_to_main',
  displayName: '合并到 main',
  role,
  requiredReports: ['MERGE_REPORT'],
  autoAdvance: false,
});

const STANDARD_DEV_MIDDLE: StepDef[] = [
  {
    name: 'test_env_deploy',
    displayName: '部署测试环境',
    role: 'ops',
    requiredReports: ['DEV_SELF_CHECK'],
    autoAdvance: false,
  },
  {
    name: 'testing',
    displayName: '测试验证',
    role: 'tester',
    requiredReports: [],
    autoAdvance: false,
  },
  {
    name: 'qa_review_test',
    displayName: 'QA审查(测试报告)',
    role: 'qa',
    requiredReports: ['TEST_REPORT'],
    autoAdvance: false,
  },
  {
    name: 'security_review',
    displayName: '安全审查',
    role: 'security',
    requiredReports: ['TEST_REPORT'],
    autoAdvance: false,
  },
  {
    name: 'qa_review_security',
    displayName: 'QA审查(安全报告)',
    role: 'qa',
    requiredReports: ['SECURITY_REVIEW'],
    autoAdvance: false,
  },
  {
    name: 'cto_review',
    displayName: 'CTO验收',
    role: 'cto',
    // CTO 看 QA 审过的测试报告 + 安全报告（安全非必须）
    // 注意：实际门禁在代码里会根据需求类型过滤 SECURITY_REVIEW
    requiredReports: ['TEST_REPORT'],
    autoAdvance: false,
  },
  {
    name: 'deploying',
    displayName: '部署上线',
    role: 'ops',
    requiredReports: ['CTO_REVIEW'],
    autoAdvance: false,
  },
  {
    name: 'qa_review_deploy',
    displayName: 'QA验证部署',
    role: 'qa',
    requiredReports: ['DEPLOY_CONFIRM'],
    autoAdvance: false,
  },
  {
    name: 'done',
    displayName: '已完成',
    role: 'cto',
    requiredReports: ['DEPLOY_CONFIRM'],
    autoAdvance: false,
  },
];

const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: 'backend-dev',
    displayName: '后端开发流程',
    description: 'PM审批→开发→QA审→部署测试→测试→QA审→安全→QA审→CTO→部署→QA验证→完成',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '后端开发自检',
        role: 'backend_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      mergeToMain('backend_developer'),
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'frontend-dev',
    displayName: '前端开发流程',
    description: 'PM审批→开发→QA审→部署测试→测试→QA审→安全→QA审→CTO→部署→QA验证→完成',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '前端开发自检',
        role: 'frontend_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      mergeToMain('frontend_developer'),
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'mobile-dev',
    displayName: '移动端开发流程',
    description: 'PM审批→开发→QA审→部署测试→测试→QA审→安全→QA审→CTO→部署→QA验证→完成',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '移动端开发自检',
        role: 'mobile_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      mergeToMain('mobile_developer'),
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'miniapp-dev',
    displayName: '小程序开发流程',
    description: 'PM审批→开发→QA审→部署测试→测试→QA审→安全→QA审→CTO→部署→QA验证→完成',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '小程序开发自检',
        role: 'miniapp_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'game-dev',
    displayName: '游戏开发流程',
    description: 'PM审批→开发→QA审→部署测试→测试→QA审→安全→QA审→CTO→部署→QA验证→完成',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '游戏开发自检',
        role: 'game_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      mergeToMain('game_developer'),
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'security-fix',
    displayName: '安全修复流程',
    description: 'PM审批→修复→QA审→安全验证→QA审安全→CTO→部署→QA验证→完成',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '修复自检',
        role: 'backend_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      mergeToMain('backend_developer'),
      QA_REVIEW_DEV,
      {
        name: 'security_review',
        displayName: '安全验证',
        role: 'security',
        requiredReports: [],
        autoAdvance: false,
      },
      {
        name: 'qa_review_security',
        displayName: 'QA审查(安全报告)',
        role: 'qa',
        requiredReports: ['SECURITY_REVIEW'],
        autoAdvance: false,
      },
      {
        name: 'cto_review',
        displayName: 'CTO验收',
        role: 'cto',
        requiredReports: [],
        autoAdvance: false,
      },
      {
        name: 'deploying',
        displayName: '部署上线',
        role: 'ops',
        requiredReports: ['CTO_REVIEW'],
        autoAdvance: false,
      },
      {
        name: 'qa_review_deploy',
        displayName: 'QA验证部署',
        role: 'qa',
        requiredReports: ['DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
      {
        name: 'done',
        displayName: '已完成',
        role: 'cto',
        requiredReports: ['DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
    ],
  },
  {
    name: 'hotfix',
    displayName: '紧急修复',
    description: '紧急修复流程（跳过PM和QA审查，但部署仍需QA验证）',
    steps: [
      {
        name: 'dev_self_check',
        displayName: '紧急修复自检',
        role: 'backend_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      {
        name: 'deploying',
        displayName: '紧急部署',
        role: 'ops',
        requiredReports: [],
        autoAdvance: false,
      },
      {
        name: 'qa_review_deploy',
        displayName: 'QA验证部署',
        role: 'qa',
        requiredReports: ['DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
      {
        name: 'done',
        displayName: '完成',
        role: 'auto',
        requiredReports: ['DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
    ],
  },
  {
    name: 'ops-deploy',
    displayName: '运维部署流程',
    description: '纯部署/配置类需求：CTO审批→部署→QA验证→完成',
    steps: [
      {
        name: 'cto_review',
        displayName: 'CTO审批',
        role: 'cto',
        requiredReports: [],
        autoAdvance: false,
      },
      {
        name: 'deploying',
        displayName: '部署执行',
        role: 'ops',
        requiredReports: ['CTO_REVIEW'],
        autoAdvance: false,
      },
      {
        name: 'qa_review_deploy',
        displayName: 'QA验证部署',
        role: 'qa',
        requiredReports: ['DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
      {
        name: 'done',
        displayName: '已完成',
        role: 'cto',
        requiredReports: ['DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
    ],
  },
];

/**
 * Upsert all default workflow templates.
 * Safe to call on every startup — will only insert if missing, update if changed.
 * Deactivated templates: standard-dev, fullstack-dev (replaced by role-specific templates).
 */
export async function ensureWorkflowTemplates(): Promise<void> {
  for (const tmpl of DEFAULT_TEMPLATES) {
    await prisma.workflowTemplate.upsert({
      where: { name: tmpl.name },
      update: {
        displayName: tmpl.displayName,
        description: tmpl.description,
        steps: tmpl.steps as any,
        isActive: true,
      },
      create: {
        name: tmpl.name,
        displayName: tmpl.displayName,
        description: tmpl.description,
        steps: tmpl.steps as any,
        isActive: true,
      },
    });
  }

  // 停用已废弃的模板
  for (const deprecated of ['standard-dev', 'fullstack-dev']) {
    await prisma.workflowTemplate.updateMany({
      where: { name: deprecated, isActive: true },
      data: { isActive: false },
    });
  }

  console.log(`[workflow-templates] Ensured ${DEFAULT_TEMPLATES.length} default templates`);
}
