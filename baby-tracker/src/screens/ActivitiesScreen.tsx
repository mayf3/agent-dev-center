import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { COLORS, SAMPLE_ACTIVITIES } from '../constants';
import type { Activity } from '../types';

const ACTIVITIES_KEY = 'baby-tracker-activities';

export default function ActivitiesScreen() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(ACTIVITIES_KEY);
        if (raw) setActivities(JSON.parse(raw));
        else setActivities(SAMPLE_ACTIVITIES);
      } catch {
        setActivities(SAMPLE_ACTIVITIES);
      }
      setLoaded(true);
    })();
  }, []);

  const save = async (acts: Activity[]) => {
    setActivities(acts);
    try { await SecureStore.setItemAsync(ACTIVITIES_KEY, JSON.stringify(acts)); } catch {}
  };

  const toggleDone = (id: string) => {
    const updated = activities.map((a) => a.id === id ? { ...a, done: !a.done, date: !a.done ? new Date().toISOString() : undefined } : a);
    save(updated);
  };

  const filtered = filter === 'all' ? activities : filter === 'done' ? activities.filter(a => a.done) : filter === 'todo' ? activities.filter(a => !a.done) : activities.filter(a => a.category === filter);

  const types = [
    { key: 'all', label: '全部', icon: 'apps' },
    { key: 'todo', label: '待完成', icon: 'time' },
    { key: 'done', label: '已完成', icon: 'checkmark-circle' },
    { key: 'math', label: '数学', icon: 'calculator' },
    { key: 'lang', label: '语言', icon: 'chatbubbles' },
    { key: 'science', label: '科学', icon: 'flask' },
    { key: 'art', label: '艺术', icon: 'color-palette' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* 过滤 Tabs */}
      <View style={{ maxHeight: 56 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          {types.map((t) => (
            <TouchableOpacity key={t.key} style={[st.tab, filter === t.key && st.tabActive]} onPress={() => setFilter(t.key)}>
              <Ionicons name={t.icon as any} size={14} color={filter === t.key ? '#fff' : COLORS.textSecondary} />
              <Text style={[st.tabText, filter === t.key && { color: '#fff' }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {filtered.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Ionicons name="happy-outline" size={48} color={COLORS.textTertiary} />
            <Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>{loaded ? '暂无活动' : '加载中...'}</Text>
          </View>
        ) : filtered.map((act) => (
          <View key={act.id} style={[st.card, act.done && { opacity: 0.7 }]}>
            <TouchableOpacity onPress={() => toggleDone(act.id)} style={{ position: 'absolute', top: 14, right: 14, zIndex: 1 }}>
              <Ionicons name={act.done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={act.done ? COLORS.success : COLORS.textTertiary} />
            </TouchableOpacity>
            <View style={st.cardHeader}>
              <View style={[st.typeBadge, { backgroundColor: act.type === 'game' ? '#FFF0F5' : act.type === 'experiment' ? '#F0FFF4' : act.type === 'outdoor' ? '#FFF8E1' : act.type === 'reading' ? '#E8F4FD' : '#F3E8FF' }]}>
                <Ionicons name={act.type === 'game' ? 'game-controller' : act.type === 'experiment' ? 'flask' : act.type === 'outdoor' ? 'sunny' : act.type === 'reading' ? 'book' : 'chatbubbles'} size={16} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={st.cardTitle}>{act.title}</Text>
                <Text style={st.cardMeta}>{act.duration} · {'😊'.repeat(act.difficulty)}{'😐'.repeat(3 - act.difficulty)}</Text>
              </View>
            </View>
            {act.materials.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10, gap: 6 }}>
                {act.materials.map((m, i) => (
                  <View key={i} style={{ backgroundColor: COLORS.warmLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}>
                    <Text style={{ fontSize: 12, color: '#B8860B' }}>📦 {m}</Text>
                  </View>
                ))}
              </View>
            )}
            <View style={{ backgroundColor: COLORS.background, borderRadius: 10, padding: 12 }}>
              {act.steps.map((step, i) => (
                <View key={i} style={{ flexDirection: 'row', marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, color: COLORS.textSecondary, width: 20 }}>{i + 1}.</Text>
                  <Text style={{ fontSize: 13, color: COLORS.text, flex: 1 }}>{step}</Text>
                </View>
              ))}
            </View>
            {act.done && act.date && (
              <Text style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 8, textAlign: 'right' }}>
                ✅ {new Date(act.date).toLocaleDateString('zh-CN')}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 4, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, gap: 4 },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 13, color: COLORS.textSecondary },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 12, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, shadowOffset: { width: 0, height: 2 }, shadowColor: '#000' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingRight: 30 },
  typeBadge: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  cardMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
});
