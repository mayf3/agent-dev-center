import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, PRIORITY_CONFIG } from '../constants';
import * as requirementsApi from '../api/requirements';
import type { RequirementPriority } from '../types';

const PRIORITIES: RequirementPriority[] = ['P0', 'P1', 'P2', 'P3'];

export default function CreateDemandScreen({ navigation }: any) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'P2' as RequirementPriority, department: '' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) { Alert.alert('提示', '请输入需求标题'); return; }
    if (!form.description.trim()) { Alert.alert('提示', '请输入需求描述'); return; }
    try {
      setLoading(true);
      await requirementsApi.create({
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        department: form.department.trim() || '通用',
      });
      Alert.alert('成功', '需求已提交！', [{ text: '确定', onPress: () => navigation.goBack() }]);
    } catch (e: any) { Alert.alert('提交失败', e.message || '请稍后重试');
    } finally { setLoading(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: 16 }}>
      <Text style={fg.label}>需求标题 <Text style={{ color: COLORS.error }}>*</Text></Text>
      <TextInput style={fg.input} placeholder="请输入需求标题" placeholderTextColor={COLORS.textTertiary}
        value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} maxLength={100} />
      <Text style={fg.label}>需求描述 <Text style={{ color: COLORS.error }}>*</Text></Text>
      <TextInput style={[fg.input, { minHeight: 140, textAlignVertical: 'top', paddingTop: 14 }]}
        placeholder="描述需求内容、目标、验收标准..." placeholderTextColor={COLORS.textTertiary}
        value={form.description} onChangeText={(t) => setForm({ ...form, description: t })} multiline />
      <Text style={fg.label}>优先级</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {PRIORITIES.map((p) => {
          const cfg = PRIORITY_CONFIG[p];
          const active = form.priority === p;
          return (
            <TouchableOpacity key={p} style={[{ flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface }, active && { backgroundColor: cfg.color, borderColor: cfg.color }]}
              onPress={() => setForm({ ...form, priority: p })}>
              <Text style={[{ fontSize: 14, color: COLORS.textSecondary, fontWeight: '500' }, active && { color: '#fff', fontWeight: '700' }]}>{cfg.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[fg.label, { marginTop: 20 }]}>业务部门</Text>
      <TextInput style={fg.input} placeholder="例如：平台产品" placeholderTextColor={COLORS.textTertiary}
        value={form.department} onChangeText={(t) => setForm({ ...form, department: t })} />
      <TouchableOpacity style={[sb.btn, loading && { opacity: 0.7 }]} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={20} color="#fff" /><Text style={sb.text}>提交需求</Text></>}
      </TouchableOpacity>
    </ScrollView>
  );
}
const fg = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: COLORS.text },
});
const sb = StyleSheet.create({
  btn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary, height: 52, borderRadius: 12, gap: 8, marginTop: 28, shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4, shadowOffset: { width: 0, height: 4 } },
  text: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
