-- 初始化测试环境锁：将最早进入 test_env_deploy 的需求设为锁持有者
-- 其余 35 条留在 test_env_deploy 等待自动推进
INSERT INTO "test_env_lock" (id, "requirementId", "requirementTitle", branch, "acquiredAt")
SELECT 'singleton', id, title, branch, MIN("updatedAt") OVER ()
FROM "requirements"
WHERE "currentStep" = 'test_env_deploy'
ORDER BY "updatedAt" ASC
LIMIT 1
ON CONFLICT (id) DO NOTHING;
