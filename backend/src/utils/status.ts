import type {
  Project,
  Requirement,
  Task,
  TaskStatus
} from '@prisma/client';

/**
 * @deprecated Requirement.status was removed. Use Requirement.currentStep instead.
 */
export const requirementStatusValues = [
  'pending',
  'clarifying',
  'approved',
  'rejected',
  'in-progress',
  'testing',
  'review',
  'deploying',
  'done',
  'abandoned',
  'archived',
  'draft'
] as const;

export const taskStatusValues = ['todo', 'in-progress', 'done'] as const;

export type TaskStatusApi = (typeof taskStatusValues)[number];

export const prismaTaskStatus = {
  todo: 'todo',
  'in-progress': 'in_progress',
  done: 'done'
} satisfies Record<TaskStatusApi, TaskStatus>;

export const apiTaskStatus = {
  todo: 'todo',
  in_progress: 'in-progress',
  done: 'done'
} satisfies Record<TaskStatus, TaskStatusApi>;

export type SerializedTask = Omit<Task, 'status'> & {
  status: TaskStatusApi;
};

export type SerializedRequirement = Omit<Requirement, 'assignee'> & {
  currentStep: string | null;
  assignee?: string | null;  // resolved from assigneeUser.name
  tasks?: SerializedTask[];
  project?: Pick<Project, 'id' | 'name' | 'boundaries'> | null;
};

export function serializeTask(task: Task): SerializedTask {
  return {
    ...task,
    status: apiTaskStatus[task.status]
  };
}

export function serializeRequirement(
  requirement: (Requirement & {
    tasks?: Task[];
    assigneeUser?: { name: string } | null;
    project?: Pick<Project, 'id' | 'name' | 'boundaries'> | null;
  })
): SerializedRequirement {
  return {
    ...requirement,
    currentStep: requirement.currentStep,
    assignee: requirement.assigneeUser?.name ?? requirement.assignee,
    tasks: requirement.tasks?.map(serializeTask)
  };
}
