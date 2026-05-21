import type {
  Requirement,
  RequirementStatus,
  Task,
  TaskStatus
} from '@prisma/client';

export const requirementStatusValues = [
  'pending',
  'clarifying',
  'approved',
  'rejected',
  'in-progress',
  'testing',
  'review',
  'deploying',
  'done'
] as const;

export const taskStatusValues = ['todo', 'in-progress', 'done'] as const;

export type RequirementStatusApi = (typeof requirementStatusValues)[number];
export type TaskStatusApi = (typeof taskStatusValues)[number];

export const prismaRequirementStatus = {
  pending: 'pending',
  clarifying: 'clarifying',
  approved: 'approved',
  rejected: 'rejected',
  'in-progress': 'in_progress',
  testing: 'testing',
  review: 'review',
  deploying: 'deploying',
  done: 'done'
} satisfies Record<RequirementStatusApi, RequirementStatus>;

export const apiRequirementStatus = {
  pending: 'pending',
  clarifying: 'clarifying',
  approved: 'approved',
  rejected: 'rejected',
  in_progress: 'in-progress',
  testing: 'testing',
  review: 'review',
  deploying: 'deploying',
  done: 'done'
} satisfies Record<RequirementStatus, RequirementStatusApi>;

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

export type SerializedRequirement = Omit<Requirement, 'status'> & {
  status: RequirementStatusApi;
  tasks?: SerializedTask[];
};

export function serializeTask(task: Task): SerializedTask {
  return {
    ...task,
    status: apiTaskStatus[task.status]
  };
}

export function serializeRequirement(
  requirement: Requirement & { tasks?: Task[] }
): SerializedRequirement {
  return {
    ...requirement,
    status: apiRequirementStatus[requirement.status],
    tasks: requirement.tasks?.map(serializeTask)
  };
}
