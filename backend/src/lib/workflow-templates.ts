/**
 * Default Workflow Templates
 *
 * 应用启动时自动 upsert，确保每个环境都有标准工作流模板。
 * 如需新增模板，在此文件添加即可。
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

const PM_REVIEW_STEP: StepDef = {
  name: 'pm_review',
  displayName: 'PM需求评审',
  role: 'pm',
  requiredReports: [],
  autoAdvance: false,
};

const QA_REVIEW_STEP: StepDef = {
  name: 'qa_review',
  displayName: 'QA质量审查',
  role: 'qa',
  requiredReports: ['DEV_SELF_CHECK'],
  autoAdvance: false,
};

const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: 'frontend-dev',
    displayName: '前端开发流程',
    description: 'PM评审→前端开发→QA审查→部署测试环境→测试→安全→CTO→部署→完成',
    steps: [
      PM_REVIEW_STEP,
      {
        name: 'dev_self_check',
        displayName: '前端开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: true,
      },
      { ...QA_REVIEW_STEP },
      {
        name: 'test_env_deploy',
        displayName: '部署测试环境',
        role: 'ops',
        requiredReports: ['TEST_DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
      {
        name: 'testing',
        displayName: '测试验证',
        role: 'tester',
        requiredReports: [],
        autoAdvance: true,
      },
      {
        name: 'security_review',
        displayName: '安全审查',
        role: 'security',
        requiredReports: ['TEST_REPORT'],
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
    name: 'standard-dev',
    displayName: '标准开发流程',
    description: 'PM评审→开发自检→QA审查→部署测试环境→测试→安全→CTO→部署→完成',
    steps: [
      PM_REVIEW_STEP,
      {
        name: 'dev_self_check',
        displayName: '开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: true,
      },
      { ...QA_REVIEW_STEP },
      {
        name: 'test_env_deploy',
        displayName: '部署测试环境',
        role: 'ops',
        requiredReports: ['TEST_DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
      {
        name: 'testing',
        displayName: '测试验证',
        role: 'tester',
        requiredReports: [],
        autoAdvance: true,
      },
      {
        name: 'security_review',
        displayName: '安全审查',
        role: 'security',
        requiredReports: ['TEST_REPORT'],
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
    name: 'backend-dev',
    displayName: '后端开发流程',
    description: 'PM评审→后端开发→QA审查→部署测试环境→测试→安全→CTO→部署→完成',
    steps: [
      PM_REVIEW_STEP,
      {
        name: 'dev_self_check',
        displayName: '后端开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: true,
      },
      { ...QA_REVIEW_STEP },
      {
        name: 'test_env_deploy',
        displayName: '部署测试环境',
        role: 'ops',
        requiredReports: ['TEST_DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
      {
        name: 'testing',
        displayName: '测试验证',
        role: 'tester',
        requiredReports: [],
        autoAdvance: true,
      },
      {
        name: 'security_review',
        displayName: '安全审查',
        role: 'security',
        requiredReports: ['TEST_REPORT'],
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
    name: 'fullstack-dev',
    displayName: '全栈开发流程',
    description: 'PM评审→开发→QA审查→部署测试环境→测试→安全→CTO→部署→完成',
    steps: [
      PM_REVIEW_STEP,
      {
        name: 'dev_self_check',
        displayName: '开发自检（前后端）',
        role: 'developer',
        requiredReports: [],
        autoAdvance: true,
      },
      { ...QA_REVIEW_STEP },
      {
        name: 'test_env_deploy',
        displayName: '部署测试环境',
        role: 'ops',
        requiredReports: ['TEST_DEPLOY_CONFIRM'],
        autoAdvance: false,
      },
      {
        name: 'testing',
        displayName: '测试验证',
        role: 'tester',
        requiredReports: [],
        autoAdvance: true,
      },
      {
        name: 'security_review',
        displayName: '安全审查',
        role: 'security',
        requiredReports: ['TEST_REPORT'],
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
    name: 'security-fix',
    displayName: '安全修复流程',
    description: '安全漏洞修复：PM评审→修复→安全验证→CTO→部署',
    steps: [
      PM_REVIEW_STEP,
      {
        name: 'dev_self_check',
        displayName: '修复自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
      {
        name: 'security_review',
        displayName: '安全验证',
        role: 'security',
        requiredReports: ['DEV_SELF_CHECK'],
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
    name: 'ops-deploy',
    displayName: '运维部署流程',
    description: '纯部署/配置类：PM评审→CTO审批→部署确认',
    steps: [
      PM_REVIEW_STEP,
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
