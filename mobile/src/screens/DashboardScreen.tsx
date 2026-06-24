import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { COLORS, STATUS_CONFIG, PRIORITY_CONFIG } from '../constants';
import * as requirementsApi from '../api/requirements';
import type { DashboardStats, Requirement } from '../types';
import type { RootStackParamList, MainTabParamList } from '../navigation/AppNavigator';

type Nav = CompositeNavigationProp<NativeStackNavigationProp<MainTabParamList, 'Dashboard'>, NativeStackNavigationProp<RootStackParamList>>;

const StatCard = ({ icon, label, value, color, bg }: { icon: any; label: string; value: number; color: string; bg: string }) => (
  <View style={[cardS.card, { borderLeftColor: color }]}>
    <View style={[cardS.icon, { backgroundColor: bg }]}><Ionicons name={icon} size={20} color={color} /></View>
    <View style={cardS.info}><Text style={cardS.val}>{value}</Text><Text style={cardS.lbl}>{label}</Text></View>
  </View>
);
const cardS = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', borderLeftWidth: 4, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, shadowOffset: { width: 0, height: 1 }, shadowColor: '#000' },
  icon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  info: { flex: 1 }, val: { fontSize: 22, fontWeight: '700', color: COLORS.text }, lbl: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
});

const DemandCard = ({ item, onPress }: { item: Requirement; onPress: () => void }) => {
  const st = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
  const p = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.P2;
  return (
    <TouchableOpacity style={dc.card} onPress={onPress} activeOpacity={0.7}>
      <View style={dc.hdr}><Text style={dc.title} numberOfLines={1}>{item.title}</Text><View style={[dc.badge, { backgroundColor: st.bgColor }]}><Text style={{ fontSize: 12, fontWeight: '500', color: st.color }}>{st.label}</Text></View></View>
      <View style={dc.ftr}><View style={[dc.pri, { backgroundColor: p.bgColor }]}><Text style={{ fontSize: 12, fontWeight: '500', color: p.color }}>{p.label}</Text></View><Text style={dc.time}>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</Text></View>
    </TouchableOpacity>
  );
};
const dc = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, marginBottom: 10, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, shadowOffset: { width: 0, height: 1 }, shadowColor: '#000' },
  hdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '600', color: COLORS.text, flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  ftr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pri: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  time: { fontSize: 12, color: COLORS.textTertiary },
});

export default function DashboardScreen() {
  const { user } = useAuth();
  const nav = useNavigation<Nav>();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<Requirement[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => { load(); }, []));
  const load = async () => {
    try {
      const [s, r] = await Promise.all([requirementsApi.getStats(), requirementsApi.getRecent(5)]);
      setStats(s); setRecent(r);
    } catch { setStats({ totalDemands: 0, pendingCount: 0, activeCount: 0, testingCount: 0, doneCount: 0 }); setRecent([]);
    } finally { setLoading(false); }
  };
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}>
      <View style={st.welcome}><View><Text style={st.wt}>欢迎回来 👋</Text><Text style={st.un}>{user?.name || '用户'}</Text></View><TouchableOpacity style={st.add} onPress={() => nav.navigate('CreateDemand')}><Ionicons name="add" size={24} color="#fff" /></TouchableOpacity></View>
      {stats && <View style={st.grid}>
        <View style={{ flexDirection: 'row', marginBottom: 12 }}><View style={{ flex: 1, paddingHorizontal: 4 }}><StatCard icon="documents" label="总需求" value={stats.totalDemands} color={COLORS.primary} bg="#EEF2FF" /></View><View style={{ flex: 1, paddingHorizontal: 4 }}><StatCard icon="time" label="待审核" value={stats.pendingCount} color="#F59E0B" bg="#FEF3C7" /></View></View>
        <View style={{ flexDirection: 'row' }}><View style={{ flex: 1, paddingHorizontal: 4 }}><StatCard icon="construct" label="开发中" value={stats.activeCount} color="#8B5CF6" bg="#EDE9FE" /></View><View style={{ flex: 1, paddingHorizontal: 4 }}><StatCard icon="checkmark-circle" label="已完成" value={stats.doneCount} color="#10B981" bg="#D1FAE5" /></View></View>
      </View>}
      <View style={st.sec}><View style={st.sh}><Text style={st.sTitle}>最近需求</Text><TouchableOpacity onPress={() => nav.navigate('Demands')}><Text style={{ color: COLORS.primary, fontSize: 14, fontWeight: '500' }}>查看全部</Text></TouchableOpacity></View>
        {recent.length > 0 ? recent.map((r) => <DemandCard key={r.id} item={r} onPress={() => nav.navigate('DemandDetail', { demandId: r.id })} />) : (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}><Ionicons name="document-text-outline" size={48} color={COLORS.textTertiary} /><Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>暂无需求</Text></View>
        )}
      </View>
    </ScrollView>
  );
}
const st = StyleSheet.create({
  welcome: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: COLORS.primary, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, paddingBottom: 28 },
  wt: { fontSize: 16, color: 'rgba(255,255,255,0.8)' }, un: { fontSize: 24, fontWeight: '700', color: '#fff', marginTop: 4 },
  add: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' },
  grid: { paddingHorizontal: 16, marginTop: 16 },
  sec: { paddingHorizontal: 16, marginTop: 8, marginBottom: 24 },
  sh: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 4 },
  sTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text },
});
