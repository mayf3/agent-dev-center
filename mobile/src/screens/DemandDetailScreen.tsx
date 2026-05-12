import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { COLORS, STATUS_CONFIG, PRIORITY_CONFIG, ROLE_LABELS } from '../constants';
import * as requirementsApi from '../api/requirements';
import type { Requirement, RequirementStatus } from '../types';

interface Props { route: { params: { demandId: string } }; navigation: any }
export default function DemandDetailScreen({ route, navigation }: Props) {
  const { demandId } = route.params;
  const { user } = useAuth();
  const [d, setD] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => { load(); }, [demandId]);
  const load = async () => { try { setLoading(true); setD(await requirementsApi.getById(demandId)); } catch { Alert.alert('错误', '加载失败'); } finally { setLoading(false); } };

  const approve = () => Alert.alert('确认', '批准此需求？', [
    { text: '取消', style: 'cancel' },
    { text: '确定', onPress: async () => { try { setActionLoading(true); await requirementsApi.patchStatus(demandId, { status: 'approved' }); Alert.alert('成功', '已批准'); load(); } catch (e: any) { Alert.alert('失败', e.message); } finally { setActionLoading(false); } } },
  ]);
  const reject = () => setShowReject(true);
  const confirmReject = async () => {
    if (!rejectReason.trim()) { Alert.alert('提示', '请输入拒绝原因'); return; }
    try { setActionLoading(true); await requirementsApi.patchStatus(demandId, { status: 'rejected', rejectReason: rejectReason.trim() }); setShowReject(false); setRejectReason(''); Alert.alert('成功', '已拒绝'); load(); } catch (e: any) { Alert.alert('失败', e.message); } finally { setActionLoading(false); }
  };
  const changeStatus = (status: RequirementStatus, label: string) => Alert.alert('确认', `确定${label}？`, [
    { text: '取消', style: 'cancel' },
    { text: '确定', onPress: async () => { try { setActionLoading(true); await requirementsApi.patchStatus(demandId, { status }); Alert.alert('成功', `已${label}`); load(); } catch (e: any) { Alert.alert('失败', e.message); } finally { setActionLoading(false); } } },
  ]);
  const assign = () => Alert.alert('分配', `分配给 ${user?.name}？`, [
    { text: '取消', style: 'cancel' },
    { text: '确定', onPress: async () => { try { setActionLoading(true); await requirementsApi.patchStatus(demandId, { assignee: user?.name }); Alert.alert('成功', '已分配'); load(); } catch (e: any) { Alert.alert('失败', e.message); } finally { setActionLoading(false); } } },
  ]);

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  if (!d) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ fontSize: 16, color: COLORS.textSecondary }}>需求不存在</Text></View>;

  const st = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending;
  const p = PRIORITY_CONFIG[d.priority] || PRIORITY_CONFIG.P2;
  const isAdmin = user?.role === 'admin';
  const isDev = user?.role === 'developer';
  const isMyTask = d.assignee === user?.name;
  const canManage = isAdmin || (isDev && isMyTask);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView style={{ flex: 1, padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.text, flex: 1, marginRight: 12, lineHeight: 30 }}>{d.title}</Text>
          <View style={[dbadge, { backgroundColor: st.bgColor }]}><Text style={{ fontSize: 13, fontWeight: '600', color: st.color }}>{st.label}</Text></View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 }}>
          <View style={[dbadge, { backgroundColor: p.bgColor }]}><Text style={{ fontSize: 13, fontWeight: '500', color: p.color }}>优先级：{p.label}</Text></View>
          <View style={[dbadge, { backgroundColor: '#EEF2FF' }]}><Text style={{ fontSize: 13, color: COLORS.primary, fontWeight: '500' }}>{d.department}</Text></View>
        </View>
        <View style={is}>
          {[{ icon: 'person-outline', label: '提交人', val: d.requester },
            { icon: 'person-circle-outline', label: '负责人', val: d.assignee || '未分配' },
            { icon: 'create-outline', label: '创建时间', val: new Date(d.createdAt).toLocaleString('zh-CN') },
            { icon: 'refresh-outline', label: '更新时间', val: new Date(d.updatedAt).toLocaleString('zh-CN') },
          ].map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i < 3 ? 1 : 0, borderBottomColor: '#F3F4F6' }}>
              <Ionicons name={r.icon as any} size={18} color={COLORS.textSecondary} />
              <Text style={{ fontSize: 14, color: COLORS.textSecondary, marginLeft: 8 }}>{r.label}：</Text>
              <Text style={{ fontSize: 14, color: COLORS.text, fontWeight: '500' }}>{r.val}</Text>
            </View>
          ))}
        </View>
        <View style={ds}><Text style={{ fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 10 }}>需求描述</Text><Text style={{ fontSize: 15, color: COLORS.text, lineHeight: 24 }}>{d.description}</Text></View>
        {d.status === 'rejected' && d.rejectReason && <View style={{ backgroundColor: '#FEF2F2', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#FECACA' }}><Text style={{ fontSize: 16, fontWeight: '600', color: COLORS.error, marginBottom: 8 }}>拒绝原因</Text><Text style={{ fontSize: 15, color: COLORS.error, lineHeight: 24 }}>{d.rejectReason}</Text></View>}

        <View style={{ paddingBottom: 32 }}>
          {actionLoading && <ActivityIndicator size="small" color={COLORS.primary} style={{ marginBottom: 12 }} />}
          {canManage && d.status === 'pending' && (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={[abtn, { flex: 1, backgroundColor: COLORS.success }]} onPress={approve}><Ionicons name="checkmark-circle" size={20} color="#fff" /><Text style={abt}>批准</Text></TouchableOpacity>
              <TouchableOpacity style={[abtn, { flex: 1, backgroundColor: COLORS.error }]} onPress={reject}><Ionicons name="close-circle" size={20} color="#fff" /><Text style={abt}>拒绝</Text></TouchableOpacity>
            </View>
          )}
          {isAdmin && d.status === 'approved' && !d.assignee && (
            <TouchableOpacity style={[abtn, { backgroundColor: COLORS.primary }]} onPress={assign}><Ionicons name="person-add" size={20} color="#fff" /><Text style={abt}>分配给自己</Text></TouchableOpacity>
          )}
          {canManage && d.status === 'approved' && d.assignee && (
            <TouchableOpacity style={[abtn, { backgroundColor: '#8B5CF6' }]} onPress={() => changeStatus('in-progress', '开始开发')}><Ionicons name="play" size={20} color="#fff" /><Text style={abt}>开始开发</Text></TouchableOpacity>
          )}
          {canManage && d.status === 'in-progress' && (
            <TouchableOpacity style={[abtn, { backgroundColor: '#EC4899' }]} onPress={() => changeStatus('testing', '提交测试')}><Ionicons name="flask" size={20} color="#fff" /><Text style={abt}>提交测试</Text></TouchableOpacity>
          )}
          {canManage && d.status === 'testing' && (
            <TouchableOpacity style={[abtn, { backgroundColor: COLORS.success }]} onPress={() => changeStatus('done', '标记完成')}><Ionicons name="checkmark-done" size={20} color="#fff" /><Text style={abt}>标记完成</Text></TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <Modal visible={showReject} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 24 }}>
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 24 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 16 }}>拒绝需求</Text>
            <TextInput style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, fontSize: 15, color: COLORS.text, backgroundColor: COLORS.background, minHeight: 100, marginBottom: 20, textAlignVertical: 'top' }}
              placeholder="请输入拒绝原因..." placeholderTextColor={COLORS.textTertiary} value={rejectReason} onChangeText={setRejectReason} multiline />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={{ flex: 1, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border }} onPress={() => { setShowReject(false); setRejectReason(''); }}>
                <Text style={{ fontSize: 15, color: COLORS.textSecondary, fontWeight: '500' }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.error }} onPress={confirmReject}>
                <Text style={{ fontSize: 15, color: '#fff', fontWeight: '600' }}>确认拒绝</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
import type { TextStyle, ViewStyle } from 'react-native';
const dbadge: ViewStyle = { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 };
const is: ViewStyle = { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, marginBottom: 16 };
const ds: ViewStyle = { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, marginBottom: 16 };
const abtn: ViewStyle = { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: 48, borderRadius: 12, gap: 8 };
const abt: TextStyle = { color: '#fff', fontSize: 15, fontWeight: '600' };
