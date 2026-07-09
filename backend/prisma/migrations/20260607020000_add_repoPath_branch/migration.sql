-- 4397e6a9: 需求增加代码仓库路径和分支字段
ALTER TABLE "requirements" ADD COLUMN "repoPath" TEXT;
ALTER TABLE "requirements" ADD COLUMN "branch" TEXT;
