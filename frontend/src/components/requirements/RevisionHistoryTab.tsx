/**
 * 修订历史 Tab — 需求详情页的修订记录展示
 * 从 RequirementDetailPage 拆出 (代码结构合规)
 */
import { HistoryOutlined } from '@ant-design/icons';
import { Card, Space, Spin, Tag, Timeline, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client';

interface Revision {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  revisionNote: string | null;
  operator: { id: string; name: string } | null;
  createdAt: string;
}

interface RevisionHistoryTabProps {
  requirementId: string;
}

export function RevisionHistoryTab({ requirementId }: RevisionHistoryTabProps) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRevisions = useCallback(async () => {
    if (!requirementId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/requirements/${requirementId}/revisions`, { params: { page: 1, pageSize: 50 } });
      setRevisions(data.data ?? []);
    } catch { /* silently ignore */ } finally {
      setLoading(false);
    }
  }, [requirementId]);

  useEffect(() => { void loadRevisions(); }, [loadRevisions]);

  if (loading) return <Spin />;
  if (revisions.length === 0) return <Typography.Text type="secondary">暂无修订记录</Typography.Text>;

  return (
    <Card title="状态流转历史">
      <Timeline
        items={revisions.map(rev => {
          const isStatus = rev.field === 'status';
          return {
            color: isStatus ? 'blue' : 'gray',
            children: (
              <div key={rev.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space size={4}>
                    <Tag color={isStatus ? 'blue' : 'default'}>{isStatus ? '状态变更' : rev.field}</Tag>
                    {rev.revisionNote && <Typography.Text strong>{rev.revisionNote}</Typography.Text>}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(rev.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                  </Typography.Text>
                </div>
                {(rev.oldValue || rev.newValue) && (
                  <div style={{ marginTop: 4 }}>
                    {rev.oldValue && <Typography.Text delete type="danger" style={{ fontSize: 13 }}>{rev.oldValue}</Typography.Text>}
                    {rev.oldValue && rev.newValue && <span style={{ margin: '0 8px' }}>→</span>}
                    {rev.newValue && <Typography.Text type="success" style={{ fontSize: 13 }}>{rev.newValue}</Typography.Text>}
                  </div>
                )}
                {rev.operator && <Typography.Text type="secondary" style={{ fontSize: 12 }}>操作者: {rev.operator.name}</Typography.Text>}
              </div>
            )
          };
        })}
      />
    </Card>
  );
}

export function RevisionHistoryTabLabel() {
  return <><HistoryOutlined /> 修订历史</>;
}
