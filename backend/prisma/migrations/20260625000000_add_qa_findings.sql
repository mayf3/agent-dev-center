-- Migration: add_qa_findings_field
-- Description: 添加 qa_findings JSONB 字段，支持 findings-driven QA 审查
-- Date: 2026-06-25

ALTER TABLE "RequirementReport" ADD COLUMN "qa_findings" JSONB;
