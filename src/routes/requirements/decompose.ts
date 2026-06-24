import { prisma } from '../../lib/prisma.js';
import { requireRoles } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { notifyEvent } from '../../utils/notifications.js';
import { canReadRequirement } from './utils.js';

interface DecomposedTask {
  title: string;
  description: string;
  agentType: string;
}

function decomposeRequirement(title: string, description: string): DecomposedTask[] {
  const sections: { heading: string; content: string }[] = [];
  const lines = description.split('\n');
  let currentHeading = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      if (currentHeading && currentContent.length > 0) {
        sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
      }
      currentHeading = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentHeading && currentContent.length > 0) {
    sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
  }

  const skipHeadings = ['背景', '验收标准', '验收', '背景与动机', '动机'];
  const taskSections = sections.filter(
    s => !skipHeadings.some(sh => s.heading.includes(sh))
  );

  if (taskSections.length === 0) {
    return [{ title, description, agentType: 'devtools-agent' }];
  }

  const agentHints: Record<string, string> = {
    '前端': 'devtools-agent', 'UI': 'devtools-agent', '页面': 'devtools-agent', '组件': 'devtools-agent',
    '后端': 'agent-dev-engineer', 'API': 'agent-dev-engineer', '接口': 'agent-dev-engineer', '数据库': 'agent-dev-engineer',
    '部署': 'itops-agent', '运维': 'itops-agent', '安全': 'security-agent', '测试': 'test-engineer',
  };

  return taskSections.map(section => {
    let agentType = 'devtools-agent';
    for (const [hint, agent] of Object.entries(agentHints)) {
      if (section.heading.includes(hint) || section.content.slice(0, 200).includes(hint)) {
        agentType = agent;
        break;
      }
    }
    return {
      title: `${title} — ${section.heading}`,
      description: `## ${section.heading}\n\n${section.content}`,
      agentType,
    };
  });
}

export function registerDecomposeRoutes(router: import('express').Router): void {

router.post(
  '/:id/decompose',
  requireRoles('admin', 'developer'),
  asyncHandler(async (req, res) => {
    const requirementId = String(req.params.id);
    const { confirm } = req.body as { confirm?: boolean };

    const requirement = await prisma.requirement.findUnique({
      where: { id: requirementId },
      include: { tasks: true },
    });

    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(req.user!, requirement)) throw new HttpError(403, '无权操作该需求');

    const decomposed = decomposeRequirement(requirement.title, requirement.description);

    if (!confirm) {
      res.json({
        preview: true,
        requirementId,
        requirementTitle: requirement.title,
        existingTasks: requirement.tasks.length,
        decomposedTasks: decomposed,
      });
      return;
    }

    if (requirement.tasks.length > 0) {
      throw new HttpError(400, '需求已有子任务，请先删除已有任务再拆解');
    }

    const createdTasks = await prisma.$transaction(
      decomposed.map(task =>
        prisma.task.create({
          data: { requirementId, title: task.title, description: task.description, agentType: task.agentType },
        })
      )
    );

    void notifyEvent('requirement.decomposed', {
      id: requirementId, title: requirement.title, taskCount: createdTasks.length, actor: req.user!.name,
    });

    res.status(201).json({
      preview: false,
      requirementId,
      createdTasks: createdTasks.map(t => ({ id: t.id, title: t.title, agentType: t.agentType, status: t.status })),
    });
  })
);

}
