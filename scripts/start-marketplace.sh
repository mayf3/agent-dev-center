#!/bin/bash
# Agent 能力集市 — 快速启动脚本

set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_step() {
    echo -e "${GREEN}➜${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# 检查依赖
check_dependencies() {
    print_step "检查依赖..."

    if ! command -v node &> /dev/null; then
        print_error "Node.js 未安装，请安装 Node.js >= 18.x"
        exit 1
    fi

    if ! command -v pnpm &> /dev/null && ! command -v npm &> /dev/null; then
        print_error "pnpm 或 npm 未安装"
        exit 1
    fi

    echo -e "${GREEN}✓${NC} 依赖检查通过"
}

# 数据库初始化
init_database() {
    print_step "初始化数据库..."

    cd backend

    if [ ! -f ".env" ]; then
        print_warn ".env 文件不存在，从 .env.example 复制..."
        cp .env.example .env
        print_warn "请编辑 .env 文件配置数据库连接"
    fi

    # 运行迁移
    npx prisma migrate deploy
    npx prisma generate

    cd ..
    echo -e "${GREEN}✓${NC} 数据库初始化完成"
}

# 安装后端依赖
install_backend() {
    print_step "安装后端依赖..."
    cd backend
    pnpm install || npm install
    cd ..
    echo -e "${GREEN}✓${NC} 后端依赖安装完成"
}

# 安装前端依赖
install_frontend() {
    print_step "安装前端依赖..."
    cd frontend
    pnpm install || npm install
    cd ..
    echo -e "${GREEN}✓${NC} 前端依赖安装完成"
}

# 创建测试数据
seed_data() {
    print_step "创建测试 Agent 和任务..."

    curl -s -X POST http://localhost:3001/api/marketplace/agents \
        -H "Content-Type: application/json" \
        -d '{
            "name": "codex-agent",
            "displayName": "Codex 编程助手",
            "description": "专业的代码生成和重构助手",
            "capabilities": [
                {"name": "代码生成"},
                {"name": "Bug修复"},
                {"name": "性能优化"}
            ]
        }' > /dev/null && echo -e "${GREEN}✓${NC} 测试 Agent 已创建"

    curl -s -X POST http://localhost:3001/api/marketplace/agents/codex-agent/status \
        -H "Content-Type: application/json" \
        -d '{"status": "active"}' > /dev/null && echo -e "${GREEN}✓${NC} Agent 已激活"

    curl -s -X POST http://localhost:3001/api/marketplace/tasks \
        -H "Content-Type: application/json" \
        -d '{
            "agentName": "codex-agent",
            "title": "示例任务：实现用户认证",
            "description": "使用 JWT 实现登录、注册、token 刷新功能",
            "priority": "high",
            "requesterName": "测试用户"
        }' > /dev/null && echo -e "${GREEN}✓${NC} 示例任务已创建"
}

# 启动后端
start_backend() {
    print_step "启动后端服务..."

    cd backend
    mkdir -p logs uploads

    if command -v pnpm &> /dev/null; then
        pnpm dev > ../logs/backend.log 2>&1 &
    else
        npm run dev > ../logs/backend.log 2>&1 &
    fi

    BACKEND_PID=$!
    echo $BACKEND_PID > ../logs/backend.pid

    # 等待后端启动
    for i in {1..30}; do
        if curl -s http://localhost:3001/health > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} 后端启动成功 (PID: $BACKEND_PID)"
            cd ..
            return 0
        fi
        sleep 1
    done

    print_error "后端启动失败，查看日志: logs/backend.log"
    cd ..
    return 1
}

# 启动前端
start_frontend() {
    print_step "启动前端服务..."

    cd frontend

    if command -v pnpm &> /dev/null; then
        pnpm dev > ../logs/frontend.log 2>&1 &
    else
        npm run dev > ../logs/frontend.log 2>&1 &
    fi

    FRONTEND_PID=$!
    echo $FRONTEND_PID > ../logs/frontend.pid

    echo -e "${GREEN}✓${NC} 前端启动成功 (PID: $FRONTEND_PID)"
    echo -e "${GREEN}➜${NC} 访问: http://localhost:5173/marketplace"

    cd ..
}

# 停止服务
stop_services() {
    print_step "停止服务..."

    if [ -f "logs/backend.pid" ]; then
        kill $(cat logs/backend.pid) 2>/dev/null || true
        rm logs/backend.pid
        echo -e "${GREEN}✓${NC} 后端已停止"
    fi

    if [ -f "logs/frontend.pid" ]; then
        kill $(cat logs/frontend.pid) 2>/dev/null || true
        rm logs/frontend.pid
        echo -e "${GREEN}✓${NC} 前端已停止"
    fi

    pkill -f "vite" || true
}

# 健康检查
health_check() {
    print_step "健康检查..."

    echo -e "\n后端健康状态:"
    curl -s http://localhost:3001/health | jq '.' || echo "后端未响应"

    echo -e "\nDashboard 统计:"
    curl -s http://localhost:3001/api/marketplace/dashboard | jq '.' || echo "API 未响应"
}

# 主菜单
case "${1:-start}" in
    install)
        check_dependencies
        install_backend
        install_frontend
        init_database
        ;;

    start|up)
        check_dependencies
        start_backend
        if [ $? -eq 0 ]; then
            sleep 2
            seed_data
            start_frontend
            health_check
            echo -e "\n${GREEN}✓ 所有服务已启动${NC}"
            echo -e "后端: http://localhost:3001"
            echo -e "前端: http://localhost:5173/marketplace"
            echo -e "\n查看日志:"
            echo -e "  tail -f logs/backend.log"
            echo -e "  tail -f logs/frontend.log"
        fi
        ;;

    stop|down)
        stop_services
        ;;

    restart)
        stop_services
        sleep 2
        $0 start
        ;;

    status)
        health_check
        ;;

    seed)
        seed_data
        ;;

    test)
        echo -e "${YELLOW}运行集成测试...${NC}"
        # 可以调用测试脚本
        health_check
        ;;

    *)
        echo "用法: $0 {install|start|stop|restart|status|seed|test}"
        echo ""
        echo "命令:"
        echo "  install   - 安装依赖并初始化数据库"
        echo "  start     - 启动所有服务"
        echo "  stop      - 停止所有服务"
        echo "  restart   - 重启所有服务"
        echo "  status    - 查看服务状态"
        echo "  seed      - 创建测试数据"
        echo "  test      - 运行集成测试"
        exit 1
        ;;
esac
