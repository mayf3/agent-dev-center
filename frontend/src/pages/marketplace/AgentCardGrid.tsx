/**
 * Agent 卡片网格 — 展示名称、能力描述、状态
 */
import { Avatar, Card, Col, Row, Space, Tag, Typography } from 'antd';
import type { MarketplaceAgent } from '../../api/marketplace-types';
import { MarketplaceStatusTag } from '../../components/MarketplaceStatusTag';

interface AgentCardGridProps {
  agents: MarketplaceAgent[];
}

export function AgentCardGrid({ agents }: AgentCardGridProps) {
  if (agents.length === 0) {
    return <Typography.Text type="secondary">暂无注册 Agent</Typography.Text>;
  }

  return (
    <Row gutter={[16, 16]}>
      {agents.map((agent) => (
        <Col xs={24} sm={12} md={8} lg={6} key={agent.id}>
          <Card size="small" hoverable>
            <Card.Meta
              avatar={
                <Avatar size={40} style={{ backgroundColor: '#1677ff' }}>
                  {agent.avatar || agent.displayName[0]}
                </Avatar>
              }
              title={
                <Space>
                  {agent.displayName}
                  <MarketplaceStatusTag status={agent.status} />
                </Space>
              }
              description={
                <>
                  <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 8 }}>
                    {agent.description}
                  </Typography.Paragraph>
                  <Space size={[4, 4]} wrap>
                    {Array.isArray(agent.capabilities) &&
                      agent.capabilities.slice(0, 3).map((cap, i) => (
                        <Tag key={i} style={{ fontSize: 11 }}>
                          {typeof cap === 'object' && cap !== null
                            ? (cap as { name?: string }).name ?? JSON.stringify(cap)
                            : String(cap)}
                        </Tag>
                      ))}
                    {Array.isArray(agent.capabilities) && agent.capabilities.length > 3 && (
                      <Tag style={{ fontSize: 11 }}>+{agent.capabilities.length - 3}</Tag>
                    )}
                  </Space>
                </>
              }
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}
