# Git Filter-Repo 历史重写评估报告

**日期**: 2026-06-27
**需求**: [P0][安全] .adc-token 凭据泄露 — JWT 吊销 + 后续防护 (28c26f8f)

## 背景

ADC 项目目录中发现 `.adc-token-cache` 文件，内含 game-dev-agent JWT。该文件已通过 git history 确认在特定 commit 中被提交过。

## 评估

### 泄漏范围

- **文件**: `.adc-token-cache`（2026-06-25 已清理）
- **提交**: `26c26ab` (chore: remove .adc-token-cache from repo, add to .gitignore)
- **影响**: JWT 有效期至 6/22，已过期并被吊销；可能包含的 IP 信息已封锁

### filter-repo 可行性

| 项目 | 评估 |
|------|------|
| 仓库大小 | agent-dev-center 历史 >2000 commits，多分支 |
| 重写影响 | 所有协作者的本地 repo 需重新 clone |
| 协作影响 | 所有 open PR/branch 需 rebase |
| 成本 | 高（团队成员同步成本 + CI/CD 缓存失效） |

### 推荐方案

**不建议执行 git filter-repo**，原因：
1. JWT 已过期（6/22）并被吊销，实际风险可控
2. 已有 `73143bf` 将 `.adc-token-cache` 加入 gitignore 防止再次泄露
3. 历史重写对所有开发者造成中断成本
4. GitHub/GitLab 用于安全审计的合规性重写才有必要

### 替代防护

1. ✅ `.adc-token`/`.adc-token-cache*`/.adc-token-cache.d/ 已加入 `.gitignore`
2. ✅ pre-commit hook 检测敏感文件类型和密钥模式
3. 🔲 推荐部署 gitleaks/trufflehog CI 扫描（可选增强）
