/**
 * 审计摘要 Tab — 需求详情页的审计汇总展示
 *
 * 调用 GET /api/requirements/:id/audit-summary
 * 展示后端计算的 cycleSummary 和 timeline。
 */
import { ReloadOutlined, WarningOutlined, CheckCircleOutlined, CloseCircleOutlined, LockOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Space, Spin, Statistic, Tag, Timeline, Typography, Row, Col } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { auditApi, type RequirementAuditSummary } from '../../api/audit';
import { eventTypeLabels, eventTypeColors } from '../../constants/options';

/* ─────────── Props ─────────── */

interface AuditSummaryTabProps {
  requirementId: string;
}

/* ─────────── Helpers ─────────── */

function formatTime(iso: string): string {
  return dayjs(iso).format('YYYY-MM-DD HH:mm:ss');
}

/* ─────────── Main Component ─────────── */

export function AuditSummaryTab({ requirementId }: AuditSummaryTabProps) {
  const [summary, setSummary] = useState<RequirementAuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    type: 'forbidden' | 'not-found' | 'error';
    message: string;
  } | null>(null);

  const loadSummary = useCallback(async () => {
    if (!requirementId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await auditApi.fetchAuditSummary(requirementId);
      setSummary(data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
      if (status === 403) {
        setError({ type: 'forbidden', message: '你没有权限查看该需求的审计摘要。' });
      } else if (status === 404) {
        setError({ type: 'not-found', message: '需求不存在。' });
      } else {
        setError({ type: 'error', message: msg || '加载异常，请稍后重试。' });
      }
    } finally {
      setLoading(false);
    }
  }, [requirementId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  /* ── Loading ── */
  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin />
        </div>
      </Card>
    );
  }

  /* ── Permission denied ── */
  if (error?.type === 'forbidden') {
    return (
      <Card>
        <Typography.Text type="danger">{error.message}</Typography.Text>
      </Card>
    );
  }

  /* ── Not found ── */
  if (error?.type === 'not-found') {
    return (
      <Card>
        <Typography.Text type="warning">{error.message}</Typography.Text>
      </Card>
    );
  }

  /* ── Other errors ── */
  if (error) {
    return (
      <Card>
        <Space direction="vertical">
          <Typography.Text type="danger">{error.message}</Typography.Text>
          <Button size="small" onClick={() => void loadSummary()}>重试</Button>
        </Space>
      </Card>
    );
  }

  /* ── Empty (no events) ── */
  if (!summary || summary.timeline.length === 0) {
    return (
      <Card
        title="审计摘要"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadSummary()}>
            刷新记录
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          暂无审批流水记录。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          审批流水账于 2026 年 7 月 11 日 21:10 上线，
          此前的历史记录未回填。
        </Typography.Paragraph>
      </Card>
    );
  }

  const { cycleSummary, timeline } = summary;

  /* ── Statistic cards ── */
  const advanceCount = timeline.filter((e) => e.eventType === 'WORKFLOW_ADVANCED').length;
  const workflowRejectCount = cycleSummary.workflowRejects;
  const reportApproveCount = timeline.filter((e) => e.eventType === 'REPORT_APPROVED').length;
  const reportRejectCount = cycleSummary.reportRejects;
  const guardrailCount = cycleSummary.guardrailBlocks;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {/* Refresh button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadSummary()}>
          刷新记录
        </Button>
      </div>

      {/* ── Stats Cards ── */}
      <Card title="审批统计" size="small">
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="推进次数"
              value={advanceCount}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="驳回次数"
              value={workflowRejectCount}
              prefix={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="报告批准"
              value={reportApproveCount}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="报告驳回"
              value={reportRejectCount}
              prefix={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="门禁拦截"
              value={guardrailCount}
              prefix={<LockOutlined style={{ color: '#fa8c16' }} />}
            />
          </Col>
        </Row>
      </Card>

      {/* ── Cycle Summary ── */}
      <Card
        title={
          <Space>
            <WarningOutlined />
            循环检测
          </Space>
        }
        size="small"
        extra={
          cycleSummary.suspectedLoop ? (
            <Tag color="red" icon={<WarningOutlined />}>疑似存在审批循环</Tag>
          ) : (
            <Tag color="green">未检测到审批循环</Tag>
          )
        }
      >
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="总驳回次数">{cycleSummary.totalRejects}</Descriptions.Item>
          <Descriptions.Item label="工作流驳回">{cycleSummary.workflowRejects}</Descriptions.Item>
          <Descriptions.Item label="报告驳回">{cycleSummary.reportRejects}</Descriptions.Item>
          <Descriptions.Item label="门禁拦截次数">{cycleSummary.guardrailBlocks}</Descriptions.Item>
          <Descriptions.Item label="同一步骤最大驳回次数">
            {cycleSummary.sameStepMaxRejectCount}
          </Descriptions.Item>
          <Descriptions.Item label="同一原因代码最大次数">
            {cycleSummary.sameReasonCodeMaxCount}
          </Descriptions.Item>
        </Descriptions>

        {cycleSummary.loopReasons.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>高频原因代码：</Typography.Text>
            <div style={{ marginTop: 4 }}>
              {cycleSummary.loopReasons.map((code) => (
                <Tag key={code} color="volcano" style={{ marginBottom: 4 }}>{code}</Tag>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ── Quick Timeline ── */}
      {timeline.length > 0 && (
        <Card title="完整时间线" size="small">
          <Timeline
            items={timeline.map((item) => ({
              key: item.id,
              children: (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 4,
                    }}
                  >
                    <Space size={6} wrap>
                      <Tag color={eventTypeColors[item.eventType] || 'default'}>
                        {eventTypeLabels[item.eventType] || item.summary || item.eventType}
                      </Tag>
                      {item.actorName && (
                        <Typography.Text style={{ fontSize: 13 }}>{item.actorName}</Typography.Text>
                      )}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {formatTime(item.at)}
                    </Typography.Text>
                  </div>

                  {/* Step transition */}
                  {(item.fromStep || item.toStep) && (
                    <div style={{ marginTop: 2 }}>
                      <Typography.Text style={{ fontSize: 12 }} type="secondary">
                        步骤：{item.fromStep || '-'} → {item.toStep || '-'}
                      </Typography.Text>
                    </div>
                  )}

                  {/* Reason */}
                  {item.reasonText && (
                    <div style={{ marginTop: 2 }}>
                      <Typography.Text style={{ fontSize: 12 }} type="secondary">
                        {item.reasonCode && <Tag color="orange" style={{ fontSize: 11 }}>{item.reasonCode}</Tag>}
                        {item.reasonText}
                      </Typography.Text>
                    </div>
                  )}
                </div>
              ),
            }))}
          />
        </Card>
      )}
    </Space>
  );
}
