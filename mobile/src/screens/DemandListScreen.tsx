import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, STATUS_CONFIG, PRIORITY_CONFIG } from '../constants';
import * as requirementsApi from '../api/requirements';
import type { Requirement, RequirementStatus } from '../types';
import type { RootStackParamList, MainTabParamList } from '../navigation/AppNavigator';

type Nav = CompositeNavigationProp<NativeStackNavigationProp<MainTabParamList, 'Demands'>, NativeStackNavigationProp<RootStackParamList>>;

const TABS: { key: RequirementStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'pending', label: '待审核' }, { key: 'approved', label: '已批准' },
  { key: 'in-progress', label: '开发中' }, { key: 'testing', label: '测试中' }, { key: 'done', label: '已完成' }, { key: 'rejected', label: '已拒绝' },
];

export default function DemandListScreen() {
  const nav = useNavigation<Nav>();
  const [items, setItems] = useState<Requirement[]>([]);
  const [tab, setTab] = useState<RequirementStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);

  useFocusEffect(useCallback(() => { load(1); }, [tab]));

  const load = async (p: number, append = false) => {
    if (p === 1 && !append) setLoading(true);
    try {
      const f = { page: p, pageSize: 20, status: tab === 'all' ? undefined as any : tab, search: search.trim() || undefined };
      const r = await requirementsApi.list(f);
      setItems(append ? [...items, ...r.data] : r.data);
      setTotal(r.meta.total);
      setHasMore(p < r.meta.totalPages);
      setPage(p);
    } catch { if (!append) setItems([]); } finally { setLoading(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await load(1); setRefreshing(false); };
  const onEnd = () => { if (hasMore && !loading) load(page + 1, true); };

  const renderItem = ({ item }: { item: Requirement }) => {
    const st = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    const p = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.P2;
    return (
      <TouchableOpacity style={it.card} onPress={() => nav.navigate('DemandDetail', { demandId: item.id })} activeOpacity={0.7}>
        <View style={it.hdr}><Text style={it.title} numberOfLines={1}>{item.title}</Text><View style={[it.badge, { backgroundColor: st.bgColor }]}><Text style={{ fontSize: 12, fontWeight: '500', color: st.color }}>{st.label}</Text></View></View>
        <Text style={it.desc} numberOfLines={2}>{item.description}</Text>
        <View style={it.ftr}><View style={[it.pri, { backgroundColor: p.bgColor }]}><Text style={{ fontSize: 12, fontWeight: '500', color: p.color }}>{p.label}</Text></View>
          <Text style={it.time}>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</Text></View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={st.search}><Ionicons name="search" size={18} color={COLORS.textSecondary} />
        <TextInput style={{ flex: 1, marginLeft: 8, fontSize: 15, color: COLORS.text }} placeholder="搜索需求..." placeholderTextColor={COLORS.textTertiary}
          value={search} onChangeText={setSearch} onSubmitEditing={() => load(1)} returnKeyType="search" />
        {search.length > 0 && <TouchableOpacity onPress={() => { setSearch(''); load(1); }}><Ionicons name="close-circle" size={18} color={COLORS.textTertiary} /></TouchableOpacity>}
      </View>
      <View style={{ maxHeight: 50 }}>
        <FlatList horizontal showsHorizontalScrollIndicator={false} data={TABS} keyExtractor={(x) => x.key}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={[st.tab, tab === item.key && st.tabActive]} onPress={() => setTab(item.key)}>
              <Text style={[st.tabText, tab === item.key && st.tabTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          )} />
      </View>
      <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>共 {total} 条需求</Text></View>
      {loading && items.length === 0 ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color={COLORS.primary} /></View> : (
        <FlatList data={items} keyExtractor={(x) => x.id} renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
          onEndReached={onEnd} onEndReachedThreshold={0.3}
          ListFooterComponent={loading && items.length > 0 ? <ActivityIndicator size="small" color={COLORS.primary} style={{ paddingVertical: 16 }} /> : null}
          ListEmptyComponent={<View style={{ alignItems: 'center', paddingTop: 60 }}><Ionicons name="document-text-outline" size={48} color={COLORS.textTertiary} /><Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>暂无需求</Text></View>}
          contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : { paddingHorizontal: 16, paddingBottom: 80 }} />
      )}
      <TouchableOpacity style={st.fab} onPress={() => nav.navigate('CreateDemand')}><Ionicons name="add" size={28} color="#fff" /></TouchableOpacity>
    </View>
  );
}
const st = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, marginHorizontal: 16, marginTop: 12, marginBottom: 8, paddingHorizontal: 14, borderRadius: 12, height: 44, borderWidth: 1, borderColor: COLORS.border },
  tab: { paddingHorizontal: 16, paddingVertical: 8, marginHorizontal: 4, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 13, color: COLORS.textSecondary },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8, shadowOffset: { width: 0, height: 4 } },
});
const it = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, marginBottom: 10, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, shadowOffset: { width: 0, height: 1 }, shadowColor: '#000' },
  hdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '600', color: COLORS.text, flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  desc: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20, marginBottom: 10 },
  ftr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pri: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  time: { fontSize: 12, color: COLORS.textTertiary },
});
