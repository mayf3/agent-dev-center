/**
 * 审批流水账 Tab — 需求详情页的事件流水展示
 *
 * 调用 GET /api/requirements/:id/events
 * 按时间顺序展示 RequirementEventLedger 中的事件。
 */
import {
  ReloadOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Collapse,
  Descriptions,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { auditApi, type RequirementEvent } from '../../api/audit';
import { eventTypeLabels, eventTypeColors } from '../../constants/options';

/* ─────────── Props ─────────── */

interface ApprovalLedgerTabProps {
  requirementId: string;
}

/* ─────────── Helpers ─────────── */

function formatTime(iso: string): string {
  return dayjs(iso).format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Safely render a JSON-like object as readable key-value pairs.
 * Masks known sensitive keys (backend should have sanitized, but double-check).
 */
const SENSITIVE_PREFIXES = ['token', 'password', 'secret', 'authorization', 'jwt', 'apikey'];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_PREFIXES.some((p) => lower.includes(p));
}

function renderSafeMetadata(
  obj: Record<string, unknown> | null,
): React.ReactNode {
  if (!obj || Object.keys(obj).length === 0) {
    return <Typography.Text type="secondary">无</Typography.Text>;
  }

  const entries = Object.entries(obj).filter(([k]) => !isSensitiveKey(k));

  if (entries.length === 0) {
    return <Typography.Text type="secondary">无可展示字段</Typography.Text>;
  }

  return (
    <Descriptions bordered size="small" column={1}>
      {entries.map(([key, value]) => (
        <Descriptions.Item key={key} label={key}>
          {renderSafeValue(value)}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function renderSafeValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => <div key={i}>{renderSafeValue(v)}</div>);
  }
  // Small nested objects: show as JSON string
  const str = JSON.stringify(value, null, 1);
  // If it's small enough, show inline; otherwise truncate
  return str.length > 200
    ? <Typography.Text code>{str.slice(0, 200)}…</Typography.Text>
    : <Typography.Text code>{str}</Typography.Text>;
}

/* ─────────── Event Detail (collapsible section) ─────────── */

function EventDetail({ event }: { event: RequirementEvent }) {
  const [open, setOpen] = useState(false);

  const hasTechnicalFields =
    event.metadata ||
    event.evidence ||
    event.stateVersionBefore != null ||
    event.stateVersionAfter != null ||
    event.correlationId ||
    event.source;

  if (!hasTechnicalFields) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <Button
        type="link"
        size="small"
        icon={open ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        onClick={() => setOpen(!open)}
      >
        {open ? '收起详情' : '查看详情'}
      </Button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <Collapse ghost size="small" items={[
            ...(event.metadata ? [{
              key: 'metadata',
              label: '元数据',
              children: renderSafeMetadata(event.metadata),
            }] : []),
            ...(event.evidence ? [{
              key: 'evidence',
              label: '证据',
              children: renderSafeMetadata(event.evidence),
            }] : []),
            ...((event.stateVersionBefore != null || event.stateVersionAfter != null) ? [{
              key: 'version',
              label: '状态版本',
              children: (
                <Descriptions bordered size="small" column={1}>
                  {event.stateVersionBefore != null && (
                    <Descriptions.Item label="变更前版本">{event.stateVersionBefore}</Descriptions.Item>
                  )}
                  {event.stateVersionAfter != null && (
                    <Descriptions.Item label="变更后版本">{event.stateVersionAfter}</Descriptions.Item>
                  )}
                </Descriptions>
              ),
            }] : []),
            ...(event.correlationId ? [{
              key: 'correlation',
              label: '关联标识',
              children: (
                <Typography.Text copyable code>{event.correlationId}</Typography.Text>
              ),
            }] : []),
            ...(event.source ? [{
              key: 'source',
              label: '来源',
              children: <Typography.Text>{event.source}</Typography.Text>,
            }] : []),
          ]} />
        </div>
      )}
    </div>
  );
}

/* ─────────── Main Component ─────────── */

export function ApprovalLedgerTab({ requirementId }: ApprovalLedgerTabProps) {
  const [events, setEvents] = useState<RequirementEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    type: 'forbidden' | 'not-found' | 'error';
    message: string;
  } | null>(null);

  const loadEvents = useCallback(async () => {
    if (!requirementId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await auditApi.fetchEvents(requirementId);
      setEvents(data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
      if (status === 403) {
        setError({ type: 'forbidden', message: '你没有权限查看该需求的审批流水账。' });
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
    void loadEvents();
  }, [loadEvents]);

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
          <Button size="small" onClick={() => void loadEvents()}>重试</Button>
        </Space>
      </Card>
    );
  }

  /* ── Empty state ── */
  if (events.length === 0) {
    return (
      <Card
        title="审批流水账"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadEvents()}>
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

  /* ── Events timeline ── */
  return (
    <Card
      title="审批流水账"
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadEvents()}>
          刷新记录
        </Button>
      }
    >
      <Timeline
        items={events.map((ev) => ({
          key: ev.id,
          children: (
            <div>
              {/* Header: event type + time */}
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
                  <Tag color={eventTypeColors[ev.eventType] || 'default'}>
                    {eventTypeLabels[ev.eventType] || ev.eventType}
                  </Tag>
                  {ev.actorName && (
                    <Typography.Text style={{ fontSize: 13 }}>
                      {ev.actorName}
                      {ev.actorType && ev.actorType !== 'user' && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {' '}({ev.actorType})
                        </Typography.Text>
                      )}
                    </Typography.Text>
                  )}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {formatTime(ev.createdAt)}
                </Typography.Text>
              </div>

              {/* Transitions */}
              {(ev.fromStatus || ev.toStatus) && (
                <div style={{ marginTop: 4 }}>
                  <Typography.Text style={{ fontSize: 13 }}>
                    {ev.fromStatus && (
                      <Typography.Text delete type="danger" style={{ fontSize: 13 }}>
                        {ev.fromStatus}
                      </Typography.Text>
                    )}
                    {ev.fromStatus && ev.toStatus && (
                      <span style={{ margin: '0 6px' }}>→</span>
                    )}
                    {ev.toStatus && (
                      <Typography.Text type="success" style={{ fontSize: 13 }}>
                        {ev.toStatus}
                      </Typography.Text>
                    )}
                  </Typography.Text>
                </div>
              )}

              {/* Step transition */}
              {(ev.fromStep || ev.toStep) && (
                <div style={{ marginTop: 2 }}>
                  <Typography.Text style={{ fontSize: 12 }} type="secondary">
                    步骤：
                    {ev.fromStep || '-'} → {ev.toStep || '-'}
                  </Typography.Text>
                </div>
              )}

              {/* Assignee change */}
              {(ev.fromAssigneeId || ev.toAssigneeId) && (
                <div style={{ marginTop: 2 }}>
                  <Typography.Text style={{ fontSize: 12 }} type="secondary">
                    负责人：
                    {ev.fromAssigneeId || '未分配'} → {ev.toAssigneeId || '未分配'}
                  </Typography.Text>
                </div>
              )}

              {/* Reason */}
              {(ev.reasonCode || ev.reasonText) && (
                <div style={{ marginTop: 4, background: '#fafafa', padding: '4px 8px', borderRadius: 4 }}>
                  {ev.reasonCode && (
                    <Tag color="orange" style={{ fontSize: 11 }}>{ev.reasonCode}</Tag>
                  )}
                  {ev.reasonText && (
                    <Typography.Text style={{ fontSize: 13 }}>{ev.reasonText}</Typography.Text>
                  )}
                </div>
              )}

              {/* Related report / transition */}
              {(ev.relatedReportId || ev.relatedAuditLogId) && (
                <div style={{ marginTop: 4 }}>
                  <Typography.Text style={{ fontSize: 12 }} type="secondary">
                    {ev.relatedReportId && <>关联报告：<Typography.Text code>{ev.relatedReportId}</Typography.Text></>}
                    {ev.relatedReportId && ev.relatedAuditLogId && <> · </>}
                    {ev.relatedAuditLogId && <>关联操作：<Typography.Text code>{ev.relatedAuditLogId}</Typography.Text></>}
                  </Typography.Text>
                </div>
              )}

              {/* Collapsible technical details */}
              <EventDetail event={ev} />
            </div>
          ),
        }))}
      />
    </Card>
  );
}
