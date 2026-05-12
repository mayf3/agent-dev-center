import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { COLORS, ABILITY_CATEGORIES } from '../constants';
import RadarTextView from '../components/RadarTextView';

const SCORE_KEY = 'baby-tracker-scores';

interface ScoreMap { [itemId: string]: number }

export default function DashboardScreen() {
  const [scores, setScores] = useState<ScoreMap>({});
  const [editing, setEditing] = useState<{ catId: string; itemId: string; current: number; label: string } | null>(null);
  const [showScorePicker, setShowScorePicker] = useState(false);
  const [loaded, setLoaded] = useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(SCORE_KEY);
        if (raw) setScores(JSON.parse(raw));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const saveScores = async (newScores: ScoreMap) => {
    setScores(newScores);
    try {
      await SecureStore.setItemAsync(SCORE_KEY, JSON.stringify(newScores));
    } catch {}
  };

  const setScore = (itemId: string, score: number) => {
    if (score === 0) {
      const newScores = { ...scores };
      delete newScores[itemId];
      saveScores(newScores);
    } else {
      saveScores({ ...scores, [itemId]: score });
    }
    setShowScorePicker(false);
  };

  // 计算总平均分
  const allScores = Object.values(scores);
  const avg = allScores.length > 0 ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1) : '--';

  // 准备雷达图数据
  const radarData = ABILITY_CATEGORIES.map((cat) => {
    const catScores = cat.items.map((i) => scores[i.id] || 0);
    const avgScore = catScores.length > 0 ? catScores.reduce((a, b) => a + b, 0) / catScores.length : 0;
    return { label: cat.label, score: Math.round(avgScore), color: ['#FF6B9D', '#45B7D1', '#96CEB4', '#FFEAA7', '#E8A0BF', '#A8D8EA', '#F5A623', '#7B68EE'][ABILITY_CATEGORIES.indexOf(cat) % 8] };
  }).filter(d => d.score > 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* 宝宝信息卡片 */}
      <View style={st.header}>
        <View style={st.avatar}><Ionicons name="heart" size={28} color="#fff" /></View>
        <Text style={st.title}>宝宝成长追踪</Text>
        <Text style={st.subtitle}>记录每一天的进步 ✨</Text>
      </View>

      {/* 总体概况 */}
      <View style={st.summary}>
        <View style={st.summaryItem}>
          <Text style={st.summaryValue}>{allScores.filter(s => s >= 4).length}</Text>
          <Text style={st.summaryLabel}>优秀项</Text>
        </View>
        <View style={[st.summaryItem, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: COLORS.border }]}>
          <Text style={st.summaryValue}>{avg}</Text>
          <Text style={st.summaryLabel}>平均分</Text>
        </View>
        <View style={st.summaryItem}>
          <Text style={st.summaryValue}>{allScores.length}</Text>
          <Text style={st.summaryLabel}>已评估</Text>
        </View>
      </View>

      {/* 能力雷达图 */}
      {radarData.length > 0 && (
        <View style={st.card}>
          <Text style={st.cardTitle}>能力雷达图</Text>
          <RadarTextView data={radarData} />
        </View>
      )}

      {/* 能力分类评估 */}
      {ABILITY_CATEGORIES.map((cat) => {
        const catScores = cat.items.map((i) => scores[i.id] || 0);
        const avgScore = catScores.length > 0 ? (catScores.reduce((a, b) => a + b, 0) / catScores.length) : 0;
        return (
          <View key={cat.id} style={st.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={cat.icon as any} size={20} color={COLORS.primary} />
                <Text style={st.cardTitle}>{cat.label}</Text>
              </View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.primary }}>
                {avgScore > 0 ? `${avgScore.toFixed(1)}` : '未评估'}
              </Text>
            </View>
            {cat.items.map((item) => (
              <TouchableOpacity key={item.id} style={st.abilityRow}
                onPress={() => { setEditing({ catId: cat.id, itemId: item.id, current: scores[item.id] || 0, label: item.label }); setShowScorePicker(true); }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: COLORS.text }}>{item.label}</Text>
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{item.desc}</Text>
                </View>
                <Text style={{ fontSize: 18 }}>
                  {scores[item.id] ? '★'.repeat(scores[item.id]) + '☆'.repeat(5 - scores[item.id]) : '☆☆☆☆☆'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        );
      })}

      {/* 评分选择弹窗 */}
      <Modal visible={showScorePicker} transparent animationType="fade">
        <TouchableOpacity style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1} onPress={() => setShowScorePicker(false)}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: 300, alignItems: 'center' }}>
            {editing && <><Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 4 }}>评分：{editing.label}</Text>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 20 }}>当前：{'★'.repeat(editing.current)}{'☆'.repeat(5 - editing.current)}</Text></>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <TouchableOpacity key={s} style={{ width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', backgroundColor: s <= 3 ? '#FFF3E0' : '#FFF0F5', borderWidth: 2, borderColor: s <= 3 ? '#FFB74D' : '#FF6B9D' }}
                  onPress={() => editing && setScore(editing.itemId, s)}>
                  <Text style={{ fontSize: 24 }}>{'⭐'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 16, marginBottom: 8 }}>轻触选择评分</Text>
            {editing && editing.current > 0 && <TouchableOpacity onPress={() => setScore(editing.itemId, 0)}>
              <Text style={{ fontSize: 13, color: COLORS.error }}>清除评分</Text>
            </TouchableOpacity>}
          </View>
        </TouchableOpacity>
      </Modal>

      {!loaded && <Text style={{ textAlign: 'center', color: COLORS.textSecondary, marginTop: 40 }}>加载中...</Text>}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  header: { alignItems: 'center', paddingVertical: 28, backgroundColor: COLORS.primary, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  summary: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, shadowOffset: { width: 0, height: 2 }, shadowColor: '#000' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 26, fontWeight: '700', color: COLORS.primary },
  summaryLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  card: { marginHorizontal: 16, marginTop: 16, backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, shadowOffset: { width: 0, height: 2 }, shadowColor: '#000' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  abilityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F5F0EB' },
});
