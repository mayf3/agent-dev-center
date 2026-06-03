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

const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: 'frontend-dev',
    displayName: '前端开发流程',
    description: '前端需求专用：前端开发→测试→安全→CTO→部署',
    steps: [
      {
        name: 'dev_self_check',
        displayName: '前端开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
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
    description: '标准流程：开发自检→部署测试环境→测试→安全→CTO→部署→完成',
    steps: [
      {
        name: 'dev_self_check',
        displayName: '开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
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
    description: '后端需求：后端开发→部署测试环境→测试→安全→CTO→部署→完成',
    steps: [
      {
        name: 'dev_self_check',
        displayName: '后端开发自检',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
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
    description: '全栈需求：开发→部署测试环境→测试→安全→CTO→部署→完成',
    steps: [
      {
        name: 'dev_self_check',
        displayName: '开发自检（前后端）',
        role: 'developer',
        requiredReports: [],
        autoAdvance: false,
      },
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
    description: '安全漏洞修复专用：修复→安全验证→CTO→部署',
    steps: [
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
