import { LockOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Card, Col, Form, Input, Row, Typography } from 'antd';
import type { FormProps } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface ChangePasswordFormValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function ChangePasswordPage() {
  const [form] = Form.useForm<ChangePasswordFormValues>();
  const [loading, setLoading] = useState(false);
  const { message } = AntApp.useApp();
  const navigate = useNavigate();

  const handleSubmit: FormProps<ChangePasswordFormValues>['onFinish'] = async (values) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/change-password', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword
      });
      message.success('密码修改成功，请重新登录');

      // 清除本地 token，跳转到登录页
      localStorage.removeItem('agent-dev-center-token');
      localStorage.removeItem('agent-dev-center-user');
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1000);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      message.error(err.response?.data?.message || '密码修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Row justify="center" align="middle" style={{ minHeight: '60vh' }}>
      <Col xs={22} sm={16} md={12} lg={8}>
        <Card>
          <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
            <LockOutlined /> 修改密码
          </Typography.Title>

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            autoComplete="off"
          >
            <Form.Item
              name="oldPassword"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password placeholder="请输入当前密码" />
            </Form.Item>

            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '新密码至少需要 6 个字符' }
              ]}
            >
              <Input.Password placeholder="请输入新密码（至少6位）" />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请确认新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  }
                })
              ]}
            >
              <Input.Password placeholder="请再次输入新密码" />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>
                确认修改
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Col>
    </Row>
  );
}
