/**
 * 需求详情页 — 主框架
 * 拆分后：主页面 ~350行，子组件在 components/requirements/
 */
import {
  CheckCircleOutlined, CloseCircleOutlined, EditOutlined,
  LeftOutlined, PaperClipOutlined, SaveOutlined, UserAddOutlined
} from '@ant-design/icons';
import {
  App as AntApp, Button, Card, Descriptions, Form,
  Input, Modal, Select, Space, Spin, Tabs, Typography
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Requirement } from '../../api/types';
import { PriorityTag } from '../../components/PriorityTag';
import { ReportsTimeline } from '../../components/ReportsTimeline';
import { RequirementAttachments } from '../../components/RequirementAttachments';
import { StatusTag } from '../../components/StatusTag';
import { TaskTableSection } from '../../components/requirements/TaskTableSection';
import { RevisionHistoryTab, RevisionHistoryTabLabel } from '../../components/requirements/RevisionHistoryTab';
import { RequirementModals } from '../../components/requirements/RequirementModals';
import type { ModalHandles } from '../../components/requirements/RequirementModals';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateTime, formatDate, getErrorMessage } from '../../components/requirements/utils';

const { TextArea } = Input;

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { message } = AntApp.useApp();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMobile, setIsMobile] = useState(false);
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const activeTab = searchParams.get('tab') || 'description';
  const modalsRef = useRef<ModalHandles>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const loadRequirement = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get<Requirement>(`/requirements/${id}`);
      setRequirement(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '需求详情加载失败');
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  useEffect(() => { void loadRequirement(); }, [loadRequirement]);

  useEffect(() => {
    if (!notesEditing) {
      setNotesDraft(requirement?.notes ?? '');
    }
  }, [requirement?.notes, notesEditing]);

  const handleStartNotesEdit = useCallback(() => {
    setNotesDraft(requirement?.notes ?? '');
    setNotesEditing(true);
  }, [requirement?.notes]);

  const handleCancelNotesEdit = useCallback(() => {
    setNotesDraft(requirement?.notes ?? '');
    setNotesEditing(false);
  }, [requirement?.notes]);

  const handleSaveNotes = useCallback(async () => {
    if (!requirement) return;
    setNotesSaving(true);
    try {
      const { data } = await api.put<Requirement>(`/requirements/${requirement.id}`, {
        notes: notesDraft
      });
      setRequirement(data);
      setNotesEditing(false);
      message.success('备注已更新');
    } catch (error) {
      message.error(getErrorMessage(error, '备注更新失败'));
    } finally {
      setNotesSaving(false);
    }
  }, [requirement, notesDraft, message]);

  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developer';
  const canRequesterEdit = Boolean(
    user?.role === 'requester' && requirement && ['pending', 'rejected'].includes(requirement.status)
  );

  if (loading) return <Spin className="page-spin" />;
  if (!requirement) {
    return (
      <Card>
        <Space direction="vertical">
          <Typography.Title level={4}>需求不存在或无权访问</Typography.Title>
          <Button onClick={() => navigate('/requirements')}>返回需求列表</Button>
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Space size={8} wrap>
            <Button type="text" icon={<LeftOutlined />} onClick={() => navigate('/requirements')}>返回</Button>
            <PriorityTag priority={requirement.priority} />
            <StatusTag status={requirement.status} />
          </Space>
          <Typography.Title level={3}>{requirement.title}</Typography.Title>
          <Typography.Text type="secondary">
            {requirement.department} · {requirement.requester} · 更新于 {formatDateTime(requirement.updatedAt)}
          </Typography.Text>
        </div>
        <div className="mobile-detail-actions">
          {isAdmin && isAuthenticated && (
            <>
              <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => modalsRef.current?.openAssignment('approve')}>通过</Button>
              <Button size="small" icon={<UserAddOutlined />} onClick={() => modalsRef.current?.openAssignment('assign')}>分配</Button>
              <Button size="small" danger icon={<CloseCircleOutlined />} onClick={() => modalsRef.current?.openReject()}>拒绝</Button>
            </>
          )}
          {canRequesterEdit && isAuthenticated && (
            <Button size="small" icon={<EditOutlined />} onClick={() => modalsRef.current?.openEdit()}>编辑</Button>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            if (key === 'description') searchParams.delete('tab');
            else searchParams.set('tab', key);
            setSearchParams(searchParams);
          }}
          items={[
            {
              key: 'description', label: '需求描述',
              children: (
                <Space direction="vertical" size="large" className="page-stack">
                  <Card title="需求描述">
                    <div className="markdown-body">
                      <ReactMarkdown>{requirement.description}</ReactMarkdown>
                    </div>
                  </Card>
                  <Card
                    title="备注"
                    extra={
                      notesEditing ? (
                        <Space>
                          <Button size="small" onClick={handleCancelNotesEdit} disabled={notesSaving}>取消</Button>
                          <Button
                            type="primary"
                            size="small"
                            icon={<SaveOutlined />}
                            loading={notesSaving}
                            onClick={() => void handleSaveNotes()}
                          >
                            保存
                          </Button>
                        </Space>
                      ) : (
                        isAuthenticated && (
                          <Button size="small" icon={<EditOutlined />} onClick={handleStartNotesEdit}>编辑</Button>
                        )
                      )
                    }
                  >
                    <TextArea
                      value={notesEditing ? notesDraft : requirement.notes ?? ''}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      placeholder="暂无备注"
                      rows={5}
                      disabled={!notesEditing}
                      showCount={notesEditing}
                    />
                  </Card>
                  <TaskTableSection
                    requirementId={requirement.id}
                    tasks={requirement.tasks ?? []}
                    canManage={isAdmin || isDeveloper}
                    onRefresh={loadRequirement}
                    onCreateTask={() => modalsRef.current?.openCreateTask()}
                  />
                </Space>
              )
            },
            {
              key: 'reports', label: '验收报告',
              children: <ReportsTimeline requirementId={requirement.id} isAdmin={isAdmin} />
            },
            {
              key: 'history', label: <RevisionHistoryTabLabel />,
              children: <RevisionHistoryTab requirementId={requirement.id} />
            },
            {
              key: 'attachments', label: <><PaperClipOutlined /> 附件</>,
              children: <RequirementAttachments requirementId={requirement.id} isAdmin={isAdmin} />
            },
          ]}
        />

        <Card title="需求信息">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="需求 ID">
              <Typography.Text copyable code>{requirement.id}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="标题">{requirement.title}</Descriptions.Item>
            <Descriptions.Item label="优先级"><PriorityTag priority={requirement.priority} /></Descriptions.Item>
            <Descriptions.Item label="状态"><StatusTag status={requirement.status} /></Descriptions.Item>
            <Descriptions.Item label="提交者">{requirement.requester}</Descriptions.Item>
            <Descriptions.Item label="业务部门">{requirement.department}</Descriptions.Item>
            <Descriptions.Item label="负责人">{requirement.assignee || '未分配'}</Descriptions.Item>
            <Descriptions.Item label="截止时间">{formatDate(requirement.dueDate)}</Descriptions.Item>
            <Descriptions.Item label="附件">
              {requirement.attachment ? <a href={requirement.attachment} target="_blank" rel="noreferrer">{requirement.attachment}</a> : '无'}
            </Descriptions.Item>
            <Descriptions.Item label="拒绝原因">{requirement.rejectReason || '无'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatDateTime(requirement.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{formatDateTime(requirement.updatedAt)}</Descriptions.Item>
          </Descriptions>
        </Card>
      </div>

      <RequirementModals requirement={requirement} onUpdate={setRequirement} />
    </Space>
  );
}
