import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, STATUS_CONFIG, PRIORITY_CONFIG, TASK_STATUS_CONFIG } from '../constants';
import * as requirementsApi from '../api/requirements';
import * as tasksApi from '../api/tasks';
import type { Requirement, Task, RequirementStatus, TaskStatus } from '../types';
import type { RootStackParamList, MainTabParamList } from '../navigation/AppNavigator';

type Nav = CompositeNavigationProp<NativeStackNavigationProp<MainTabParamList, 'Kanban'>, NativeStackNavigationProp<RootStackParamList>>;

// 需求看板列
const REQ_COLS = [
  { id: 'pending' as RequirementStatus, title: '待审核' },
  { id: 'in-progress' as RequirementStatus, title: '开发中' },
  { id: 'testing' as RequirementStatus, title: '测试中' },
  { id: 'done' as RequirementStatus, title: '已完成' },
];

// 任务看板列
const TASK_COLS = [
  { id: 'todo' as TaskStatus, title: '待处理' },
  { id: 'in-progress' as TaskStatus, title: '进行中' },
  { id: 'testing' as TaskStatus, title: '测试中' },
  { id: 'done' as TaskStatus, title: '已完成' },
];

export default function KanbanScreen() {
  const nav = useNavigation<Nav>();
  const [tab, setTab] = useState<'需求看板' | '任务看板'>('需求看板');
  const [reqCols, setReqCols] = useState<Record<string, Requirement[]>>({ pending: [], 'in-progress': [], testing: [], done: [] });
  const [taskCols, setTaskCols] = useState<Record<string, Task[]>>({ todo: [], 'in-progress': [], testing: [], done: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => { load(); }, []));

  const load = async () => {
    try {
      setLoading(true);
      if (tab === '需求看板') {
        const [pending, inProgress, testing, done] = await Promise.all([
          requirementsApi.list({ status: 'pending', pageSize: 50 }).catch(() => null),
          requirementsApi.list({ status: 'in-progress', pageSize: 50 }).catch(() => null),
          requirementsApi.list({ status: 'testing', pageSize: 50 }).catch(() => null),
          requirementsApi.list({ status: 'done', pageSize: 50 }).catch(() => null),
        ]);
        setReqCols({
          pending: pending?.data || [],
          'in-progress': inProgress?.data || [],
          testing: testing?.data || [],
          done: done?.data || [],
        });
      } else {
        const tasks = await tasksApi.listTasks({ pageSize: 100 } as any);
        // Kludge: listTasks returns all, we need to group
        const grouped: Record<string, Task[]> = { todo: [], 'in-progress': [], testing: [], done: [] };
        if (Array.isArray(tasks)) tasks.forEach((t) => { if (grouped[t.status]) grouped[t.status].push(t); });
        setTaskCols(grouped);
      }
    } catch (e) { console.error('看板加载失败', e);
    } finally { setLoading(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const moveReq = (item: Requirement, toStatus: RequirementStatus, label: string) => {
    Alert.alert('移动需求', `${label}「${item.title}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        try { await requirementsApi.patchStatus(item.id, { status: toStatus }); await load(); } catch (e: any) { Alert.alert('失败', e.message); }
      }},
    ]);
  };

  const moveTask = (item: Task, toStatus: TaskStatus) => {
    Alert.alert('移动任务', `将任务改为${TASK_STATUS_CONFIG[toStatus].label}？`, [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        try { await tasksApi.patchTask(item.id, { status: toStatus }); await load(); } catch (e: any) { Alert.alert('失败', e.message); }
      }},
    ]);
  };

  const cols = tab === '需求看板' ? reqCols : taskCols;
  const colDefs = tab === '需求看板' ? REQ_COLS as any[] : TASK_COLS as any[];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Tab 切换 */}
      <View style={{ flexDirection: 'row', margin: 12, backgroundColor: COLORS.surface, borderRadius: 10, padding: 4 }}>
        {['需求看板', '任务看板'].map((t) => (
          <TouchableOpacity key={t} style={{ flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: tab === t ? COLORS.primary : 'transparent' }}
            onPress={() => { setTab(t as any); load(); }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: tab === t ? '#fff' : COLORS.textSecondary }}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 看板列 */}
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 8 }}>
        {colDefs.map((col: any) => {
          const items = cols[col.id] || [];
          return (
            <View key={col.id} style={{ width: 280, marginRight: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderTopWidth: 3, borderTopColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, shadowOffset: { width: 0, height: 1 }, shadowColor: '#000' }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary, marginRight: 8 }} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text, flex: 1 }}>{col.title}</Text>
                <View style={{ backgroundColor: COLORS.background, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary }}>{items.length}</Text>
                </View>
              </View>
              <ScrollView style={{ flex: 1 }}>
                {items.map((item: any) => {
                  const p = tab === '需求看板' ? PRIORITY_CONFIG[(item as Requirement).priority] : null;
                  return (
                    <TouchableOpacity key={item.id} style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginBottom: 8, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, shadowOffset: { width: 0, height: 1 }, shadowColor: '#000' }}
                      onPress={() => nav.navigate('DemandDetail', { demandId: item.requirementId || item.id })}
                      onLongPress={() => {
                        const next = colDefs.filter((c: any) => c.id !== col.id);
                        const btn = next.map((c: any) => ({ text: `→ ${c.title}`, onPress: () => tab === '需求看板' ? moveReq(item, c.id, `移入「${c.title}」`) : moveTask(item, c.id) }));
                        Alert.alert('移动', `「${item.title}」`, [...btn, { text: '取消', style: 'cancel' as const }]);
                      }}
                      activeOpacity={0.7}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 6, lineHeight: 20 }} numberOfLines={2}>{item.title}</Text>
                      <Text style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 10 }} numberOfLines={2}>{item.description || item.agentType}</Text>
                      {p && <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: p.bgColor }}>
                          <Text style={{ fontSize: 12, fontWeight: '500', color: p.color }}>{p.label}</Text>
                        </View>
                        {item.assignee && <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>👤 {item.assignee}</Text>}
                      </View>}
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' }}>
                        {colDefs.indexOf(col) > 0 && (
                          <TouchableOpacity style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}
                            onPress={() => tab === '需求看板' ? moveReq(item, colDefs[colDefs.indexOf(col) - 1].id, `移入${colDefs[colDefs.indexOf(col) - 1].title}`) : moveTask(item, colDefs[colDefs.indexOf(col) - 1].id)}>
                            <Ionicons name="arrow-back" size={14} color={COLORS.textSecondary} />
                          </TouchableOpacity>
                        )}
                        {colDefs.indexOf(col) < colDefs.length - 1 && (
                          <TouchableOpacity style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}
                            onPress={() => tab === '需求看板' ? moveReq(item, colDefs[colDefs.indexOf(col) + 1].id, `移入${colDefs[colDefs.indexOf(col) + 1].title}`) : moveTask(item, colDefs[colDefs.indexOf(col) + 1].id)}>
                            <Ionicons name="arrow-forward" size={14} color={COLORS.textSecondary} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {items.length === 0 && <View style={{ alignItems: 'center', paddingVertical: 32 }}><Ionicons name="folder-open-outline" size={28} color={COLORS.textTertiary} /><Text style={{ fontSize: 13, color: COLORS.textTertiary, marginTop: 8 }}>暂无</Text></View>}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
