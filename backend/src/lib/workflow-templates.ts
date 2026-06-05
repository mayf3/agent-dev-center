/**
 * Default Workflow Templates
 *
 * 应用启动时自动 upsert，确保每个环境都有标准工作流模板。
 * 如需新增模板，在此文件添加即可。
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

/** QA 审查 DEV_SELF_CHECK 报告质量 */
const QA_REVIEW_DEV: StepDef = {
  name: 'qa_review',
  displayName: 'QA审查(开发自检)',
  role: 'qa',
  requiredReports: ['DEV_SELF_CHECK'],
  autoAdvance: false,
};

/** 标准开发中段：test_env_deploy → testing → qa_review → security_review → cto_review → deploying → done */
const STANDARD_DEV_MIDDLE: StepDef[] = [
  {
    name: 'test_env_deploy',
    displayName: '部署测试环境',
    role: 'ops',
    requiredReports: [],
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
    requiredReports: [],
    autoAdvance: false,
  },
  {
    name: 'cto_review',
    displayName: 'CTO验收',
    role: 'cto',
    requiredReports: ['SECURITY_REVIEW'],
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
    name: 'done',
    displayName: '已完成',
    role: 'cto',
    requiredReports: ['DEPLOY_CONFIRM'],
    autoAdvance: false,
  },
];

const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: 'standard-dev',
    displayName: '标准开发流程',
    description: 'PM审批→开发自检→QA审查→部署测试→测试→QA审查→安全→CTO→部署→完成',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'frontend-dev',
    displayName: '前端开发流程',
    description: '前端需求：PM审批→前端开发→QA审查→部署测试→测试→QA审查→安全→CTO→部署',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '前端开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'backend-dev',
    displayName: '后端开发流程',
    description: '后端需求：PM审批→后端开发→QA审查→部署测试→测试→QA审查→安全→CTO→部署',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '后端开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'fullstack-dev',
    displayName: '全栈开发流程',
    description: '全栈需求：PM审批→开发→QA审查→部署测试→测试→QA审查→安全→CTO→部署',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '开发自检（前后端）',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE,
    ],
  },
  {
    name: 'security-fix',
    displayName: '安全修复流程',
    description: '安全漏洞修复：PM审批→修复→QA审查→安全验证→CTO→部署',
    steps: [
      PM_REVIEW,
      {
        name: 'dev_self_check',
        displayName: '修复自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
      QA_REVIEW_DEV,
      {
        name: 'security_review',
        displayName: '安全验证',
        role: 'security',
        requiredReports: [],
        autoAdvance: false,
      },
      {
        name: 'cto_review',
        displayName: 'CTO验收',
        role: 'cto',
        requiredReports: ['SECURITY_REVIEW'],
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
    description: '紧急修复流程（跳过PM和QA）',
    steps: [
      {
        name: 'dev_self_check',
        displayName: '紧急修复自检',
        role: 'developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      {
        name: 'deploy',
        displayName: '紧急部署',
        role: 'ops',
        requiredReports: ['DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
      {
        name: 'done',
        displayName: '完成',
        role: 'auto',
        requiredReports: [],
        autoAdvance: false,
      },
    ],
  },
  {
    name: 'ops-deploy',
    displayName: '运维部署流程',
    description: '纯部署/配置类需求：CTO审批→部署确认',
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
  console.log(`[workflow-templates] Ensured ${DEFAULT_TEMPLATES.length} default templates`);
}
