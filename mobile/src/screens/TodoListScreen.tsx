import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import * as llmApi from '../api/llmtodo';
import type { TodoTask } from '../api/llmtodo';

const HORIZON_LABELS: Record<string, { label: string; color: string }> = {
  today: { label: '今天', color: '#EF4444' },
  week: { label: '本周', color: '#F59E0B' },
  month: { label: '本月', color: '#3B82F6' },
  quarter: { label: '季度', color: '#8B5CF6' },
  year: { label: '年度', color: '#06B6D4' },
  decade: { label: '十年', color: '#10B981' },
  lifetime: { label: '人生', color: '#6366F1' },
};

const PRIORITY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: '高', color: '#EF4444', bg: '#FEE2E2' },
  medium: { label: '中', color: '#F59E0B', bg: '#FEF3C7' },
  low: { label: '低', color: '#6B7280', bg: '#F3F4F6' },
};

export default function TodoListScreen() {
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'active' | 'done' | 'all'>('active');

  useFocusEffect(useCallback(() => { load(); }, []));

  const load = async () => {
    try {
      const data = await llmApi.getState();
      if (filter === 'active') setTasks(data.tasks);
      else if (filter === 'done') setTasks(data.history);
      else setTasks([...data.tasks, ...data.history]);
    } catch { setTasks([]);
    } finally { setLoading(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const toggleDone = async (task: TodoTask) => {
    const newStatus = task.status === 'active' ? 'done' : 'active';
    try { await llmApi.updateTask({ id: task.id, status: newStatus }); await load(); } catch {}
  };

  const renderItem = ({ item }: { item: TodoTask }) => {
    const h = HORIZON_LABELS[item.horizon] || { label: item.horizon, color: '#999' };
    const p = PRIORITY_LABELS[item.priority] || PRIORITY_LABELS.medium;
    const isDone = item.status === 'done' || item.status === 'dropped';
    return (
      <TouchableOpacity style={it.card} onPress={() => toggleDone(item)} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={[it.check, isDone && { backgroundColor: COLORS.success }]}>
            {isDone && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[it.title, isDone && { textDecorationLine: 'line-through', color: COLORS.textTertiary }]} numberOfLines={2}>{item.title}</Text>
            {item.nextAction ? <Text style={it.next} numberOfLines={1}>{item.nextAction}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <View style={[it.badge, { backgroundColor: h.color + '20' }]}><Text style={{ fontSize: 11, fontWeight: '500', color: h.color }}>{h.label}</Text></View>
              <View style={[it.badge, { backgroundColor: p.bg }]}><Text style={{ fontSize: 11, fontWeight: '500', color: p.color }}>{p.label}</Text></View>
              {item.area ? <View style={[it.badge, { backgroundColor: '#EEF2FF' }]}><Text style={{ fontSize: 11, color: COLORS.primary }}>{item.area}</Text></View> : null}
              {item.due ? <Text style={{ fontSize: 11, color: COLORS.textTertiary }}>📅 {item.due}</Text> : null}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const tabs: { key: 'active' | 'done' | 'all'; label: string }[] = [
    { key: 'active', label: '进行中' }, { key: 'done', label: '已完成' }, { key: 'all', label: '全部' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: 'row', margin: 12, backgroundColor: COLORS.surface, borderRadius: 10, padding: 4 }}>
        {tabs.map((t) => (
          <TouchableOpacity key={t.key} style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: filter === t.key ? COLORS.primary : 'transparent' }}
            onPress={() => { setFilter(t.key); load(); }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: filter === t.key ? '#fff' : COLORS.textSecondary }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color={COLORS.primary} /></View> : (
        <FlatList data={tasks} keyExtractor={(x) => x.id} renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
          ListEmptyComponent={<View style={{ alignItems: 'center', paddingTop: 60 }}><Ionicons name="checkmark-done-outline" size={48} color={COLORS.textTertiary} /><Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>暂无任务</Text></View>}
        />
      )}
    </View>
  );
}
const it = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, marginBottom: 8, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, shadowOffset: { width: 0, height: 1 }, shadowColor: '#000' },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  title: { fontSize: 15, fontWeight: '600', color: COLORS.text, lineHeight: 21 },
  next: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4, lineHeight: 18 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
});
