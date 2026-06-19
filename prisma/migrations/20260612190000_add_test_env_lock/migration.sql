-- TestEnvLock: 测试环境互斥锁，同时只有一个需求可以占用测试环境
CREATE TABLE "test_env_lock" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "requirementId" UUID NOT NULL,
    "requirementTitle" TEXT,
    "branch" TEXT,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_env_lock_pkey" PRIMARY KEY ("id")
);
