/**
 * Default Workflow Templates
 *
 * 应用启动时自动 upsert，确保每个环境都有标准工作流模板。
 * 如需新增模板，在此文件添加即可。
 *
 * 2026-06-12 v4: merge_to_main 移到 cto_review 之后
 *   - merge 前所有质量门禁必须通过（测试、安全、QA、CTO）
 *   - 测试环境部署 feature 分支，不需要先 merge
 *   - main 始终保持 tested 状态
 *   - merge_to_main role 固定为 cto
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

/** 草稿步骤 — 所有开发类需求第一步，提出者准备好后提交 PM 审批 */
const DRAFT: StepDef = {
  name: 'draft',
  displayName: '草稿',
  role: 'requester',
  requiredReports: [],
  autoAdvance: false,
};

/** PM 审批步骤 — 所有开发类需求第二步 */
const PM_REVIEW: StepDef = {
  name: 'pm_review',
  displayName: 'PM审批',
  role: 'pm',
  requiredReports: [],
  autoAdvance: false,
};

/**
 * v4-refined: 架构审查 + QA 缩编
 *
 * 完整链路（13步）：
 * draft → pm_review → arch_design → dev_self_check →
 * arch_review → qa_review → test_env_deploy →
 * testing → security_review → qa_pre_release →
 * cto_review → merge_to_main → deploying → done
 *
 * 变化（2026-06-14）：
 * - 交换 pm_review 和 arch_design 顺序：PM 先审需求，架构师再设计方案
 * - 符合产品流程：PM 决定做什么 → 架构师设计怎么做 → 开发实现
 *
 * 变化：
 * - 新增 arch_design（架构设计）
 * - 新增 arch_review（含代码质量 + 架构合规）
 * - 合并 qa_review_test + qa_review_security → qa_pre_release
 * - deploying 去掉 MERGE_REPORT
 * - 去掉 qa_review_deploy（改为自动验证）
 */

const MERGE_TO_MAIN: StepDef = {
  name: 'merge_to_main',
  displayName: '合并到 main',
  role: 'cto',
  requiredReports: ['MERGE_REPORT'],
  autoAdvance: false,
};

const QA_REVIEW_DEV: StepDef = {
  name: 'qa_review',
  displayName: 'QA审查(开发自检)',
  role: 'qa',
  requiredReports: ['DEV_SELF_CHECK'],
  autoAdvance: false,
};

/** 架构设计（非审查） */
const ARCH_DESIGN: StepDef = {
  name: 'arch_design',
  displayName: '架构设计',
  role: 'architect',
  requiredReports: ['ARCH_DESIGN'],
  autoAdvance: false,
};

/** 架构落地审查（代码质量 + 架构合规） */
const ARCH_REVIEW: StepDef = {
  name: 'arch_review',
  displayName: '架构审查(代码+设计合规)',
  role: 'architect',
  requiredReports: ['ARCH_REVIEW'],
  autoAdvance: false,
};

/** QA 预发布综合审查 */
const QA_PRE_RELEASE: StepDef = {
  name: 'qa_pre_release',
  displayName: 'QA预发布审查',
  role: 'qa',
  requiredReports: ['TEST_REPORT', 'SECURITY_REVIEW'],
  autoAdvance: false,
};

const STANDARD_DEV_MIDDLE_V4: StepDef[] = [
  { name: 'test_env_deploy', displayName: '部署测试环境', role: 'ops', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
  { name: 'testing',         displayName: '测试验证',       role: 'tester',  requiredReports: [],                    autoAdvance: false },
  { name: 'security_review', displayName: '安全审查',       role: 'security',requiredReports: [],                    autoAdvance: false },
  QA_PRE_RELEASE,
  { name: 'cto_review',      displayName: 'CTO验收',        role: 'cto',    requiredReports: ['TEST_REPORT'],        autoAdvance: false },
  MERGE_TO_MAIN,
  { name: 'deploying',       displayName: '部署上线',       role: 'ops',    requiredReports: ['CTO_REVIEW'],         autoAdvance: false },
  { name: 'done',            displayName: '已完成',         role: 'cto',    requiredReports: [],                     autoAdvance: false },
];

const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: 'backend-dev',
    displayName: '后端开发流程',
    description: '草稿→PM审批→架构设计→开发→架构审查→QA审→部署测试→测试→安全→QA预发布→CTO→合并→部署→完成',
    steps: [
      DRAFT,
      PM_REVIEW,
      ARCH_DESIGN,
      {
        name: 'dev_self_check',
        displayName: '后端开发并自检',
        role: 'backend_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      ARCH_REVIEW,
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE_V4,
    ],
  },
  {
    name: 'frontend-dev',
    displayName: '前端开发流程',
    description: '草稿→PM审批→架构设计→开发→架构审查→QA审→部署测试→测试→安全→QA预发布→CTO→合并→部署→完成',
    steps: [
      DRAFT,
      PM_REVIEW,
      ARCH_DESIGN,
      {
        name: 'dev_self_check',
        displayName: '前端开发并自检',
        role: 'frontend_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      ARCH_REVIEW,
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE_V4,
    ],
  },
  {
    name: 'mobile-dev',
    displayName: '移动端开发流程',
    description: '草稿→PM审批→架构设计→开发→架构审查→QA审→部署测试→测试→安全→QA预发布→CTO→合并→部署→完成',
    steps: [
      DRAFT,
      PM_REVIEW,
      ARCH_DESIGN,
      {
        name: 'dev_self_check',
        displayName: '移动端开发并自检',
        role: 'mobile_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      ARCH_REVIEW,
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE_V4,
    ],
  },
  {
    name: 'miniapp-dev',
    displayName: '小程序开发流程',
    description: '草稿→PM审批→架构设计→开发→架构审查→QA审→部署测试→测试→安全→QA预发布→CTO→合并→部署→完成',
    steps: [
      DRAFT,
      PM_REVIEW,
      ARCH_DESIGN,
      {
        name: 'dev_self_check',
        displayName: '小程序开发并自检',
        role: 'miniapp_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      ARCH_REVIEW,
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE_V4,
    ],
  },
  {
    name: 'game-dev',
    displayName: '游戏开发流程',
    description: '草稿→PM审批→架构设计→开发→架构审查→QA审→部署测试→测试→安全→QA预发布→CTO→合并→部署→完成',
    steps: [
      DRAFT,
      PM_REVIEW,
      ARCH_DESIGN,
      {
        name: 'dev_self_check',
        displayName: '游戏开发并自检',
        role: 'game_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      ARCH_REVIEW,
      QA_REVIEW_DEV,
      ...STANDARD_DEV_MIDDLE_V4,
    ],
  },
  {
    name: 'security-fix',
    displayName: '安全修复流程',
    description: '草稿→PM审批→架构设计→修复→QA审→安全→QA预发布→CTO→合并→部署→完成',
    steps: [
      DRAFT,
      PM_REVIEW,
      ARCH_DESIGN,
      {
        name: 'dev_self_check',
        displayName: '修复并自检',
        role: 'backend_developer',
        requiredReports: ['DEV_SELF_CHECK'],
        autoAdvance: false,
      },
      ARCH_REVIEW,
      QA_REVIEW_DEV,
      {
        name: 'security_review',
        displayName: '安全验证',
        role: 'security',
        requiredReports: [],
        autoAdvance: false,
      },
      QA_PRE_RELEASE,
      {
        name: 'cto_review',
        displayName: 'CTO验收',
        role: 'cto',
        requiredReports: [],
        autoAdvance: false,
      },
      MERGE_TO_MAIN,
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
        requiredReports: [],
        autoAdvance: false,
      },
    ],
  },
  {
    name: 'hotfix',
    displayName: '紧急修复',
    description: '紧急修复流程（跳过PM和QA审查，紧急修复后直接部署）',
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
    description: '纯部署/配置类需求：CTO审批→部署→完成',
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
        requiredReports: [],
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
