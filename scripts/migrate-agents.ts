/**
 * 43 Agent 批量迁移脚本
 *
 * 读取 llm_todo/data/agents.json → 调用 ADC /api/auth/agent/migrate API
 *
 * 用法:
 *   ADC_BASE_URL=http://localhost:3000 npx tsx scripts/migrate-agents.ts
 *   ADC_BASE_URL=http://{your-server-ip} npx tsx scripts/migrate-agents.ts --token admin-token
 */

import fs from "node:fs";
import path from "node:path";

const ADC_BASE_URL = process.env.ADC_BASE_URL || "http://localhost:3000";
const ADMIN_TOKEN = process.argv.find((a) => a.startsWith("--token="))?.split("=")[1]
  || process.argv[process.argv.indexOf("--token") + 1]
  || process.env.ADC_ADMIN_TOKEN || "";

const AGENTS_JSON = path.resolve(
  process.env.AGENTS_JSON || path.join(__dirname, "../../llm_todo/data/agents.json")
);

interface AgentData {
  id: string;
  name: string;
  category: string;
  token: string;
  capabilities: string[];
}

async function main() {
  console.log("=== Agent SSO Migration ===");
  console.log(`ADC: ${ADC_BASE_URL}`);
  console.log(`Agents file: ${AGENTS_JSON}`);

  // 1. 读取 agents.json
  if (!fs.existsSync(AGENTS_JSON)) {
    console.error(`❌ agents.json not found: ${AGENTS_JSON}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(AGENTS_JSON, "utf-8"));
  const agents: AgentData[] = raw.agents ?? raw;

  console.log(`📋 Found ${agents.length} agents`);

  if (!ADMIN_TOKEN) {
    console.error("❌ Admin token required. Use --token=xxx or ADC_ADMIN_TOKEN env");
    process.exit(1);
  }

  // 2. 调用迁移 API
  const response = await fetch(`${ADC_BASE_URL}/api/auth/agent/migrate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ agents }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("❌ Migration failed:", result);
    process.exit(1);
  }

  console.log("\n=== Migration Results ===");
  console.log(`Total:   ${result.total}`);
  console.log(`Created: ${result.created}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Errors:  ${result.errors}`);

  // 打印详细结果
  for (const r of result.results) {
    const icon = r.status === "created" ? "✅" : r.status === "skipped" ? "⏭️" : "❌";
    console.log(`  ${icon} ${r.agentId}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
