import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { COLORS } from '../constants';
import type { BabyProfile } from '../types';

const PROFILE_KEY = 'baby-tracker-profile';

export default function ProfileScreen() {
  const [profile, setProfile] = useState<BabyProfile>({ name: '', birthDate: '', allergies: [] });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', birthDate: '', allergies: '' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(PROFILE_KEY);
        if (raw) setProfile(JSON.parse(raw));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const save = async () => {
    if (!form.name.trim()) { Alert.alert('提示', '请输入宝宝名字'); return; }
    const p: BabyProfile = {
      name: form.name.trim(),
      birthDate: form.birthDate.trim(),
      allergies: form.allergies.trim() ? form.allergies.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : [],
    };
    setProfile(p);
    try { await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(p)); } catch {}
    setEditing(false);
    Alert.alert('成功', '宝宝档案已保存');
  };

  const calcAge = (birth: string) => {
    if (!birth) return '';
    const d = new Date(birth);
    const now = new Date();
    const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    const years = Math.floor(months / 12);
    const remainMonths = months % 12;
    return years > 0 ? `${years}岁${remainMonths}个月` : `${months}个月`;
  };

  if (!loaded) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text>加载中...</Text></View>;

  if (editing) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 20 }}>👶 宝宝档案</Text>
        <View style={S.inputGroup}>
          <Text style={S.label}>名字 *</Text>
          <TextInput style={S.input} placeholder="宝宝的名字" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
        </View>
        <View style={S.inputGroup}>
          <Text style={S.label}>出生日期</Text>
          <TextInput style={S.input} placeholder="YYYY-MM-DD" value={form.birthDate} onChangeText={(v) => setForm({ ...form, birthDate: v })} />
        </View>
        <View style={S.inputGroup}>
          <Text style={S.label}>过敏信息（逗号分隔）</Text>
          <TextInput style={S.input} placeholder="如有过敏写在这里" value={form.allergies} onChangeText={(v) => setForm({ ...form, allergies: v })} />
        </View>
        <TouchableOpacity style={S.btn} onPress={save}><Text style={S.btnText}>保存档案</Text></TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: 24 }}>
      <View style={S.avatarSection}>
        <View style={S.avatar}><Ionicons name="happy" size={40} color="#fff" /></View>
        <Text style={S.name}>{profile.name || '未设置'}</Text>
        {profile.birthDate && <Text style={S.age}>{calcAge(profile.birthDate)}</Text>}
        <TouchableOpacity style={S.editBtn} onPress={() => { setForm({ name: profile.name, birthDate: profile.birthDate, allergies: profile.allergies.join(', ') }); setEditing(true); }}>
          <Ionicons name="create-outline" size={16} color="#fff" /><Text style={{ color: '#fff', fontSize: 13 }}>编辑档案</Text>
        </TouchableOpacity>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>基本信息</Text>
        <View style={S.infoRow}><Text style={S.infoLabel}>名字</Text><Text style={S.infoValue}>{profile.name || '未设置'}</Text></View>
        <View style={S.infoRow}><Text style={S.infoLabel}>年龄</Text><Text style={S.infoValue}>{profile.birthDate ? calcAge(profile.birthDate) : '未设置'}</Text></View>
        <View style={S.infoRow}><Text style={S.infoLabel}>出生日期</Text><Text style={S.infoValue}>{profile.birthDate || '未设置'}</Text></View>
        <View style={S.infoRow}><Text style={S.infoLabel}>过敏</Text><Text style={S.infoValue}>{profile.allergies.length > 0 ? profile.allergies.join(', ') : '无'}</Text></View>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>统计概况</Text>
        <Text style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 }}>
          记录宝宝的成长点点滴滴，从能力评估到每日活动，见证每一步进步。
        </Text>
      </View>

      <TouchableOpacity style={S.resetBtn} onPress={() => Alert.alert('重置数据', '确定清除所有本地数据？', [
        { text: '取消', style: 'cancel' },
        { text: '确定', style: 'destructive', onPress: async () => {
          await SecureStore.deleteItemAsync('baby-tracker-scores');
          await SecureStore.deleteItemAsync('baby-tracker-activities');
          await SecureStore.deleteItemAsync(PROFILE_KEY);
          setProfile({ name: '', birthDate: '', allergies: [] });
          Alert.alert('已重置');
        }},
      ])}>
        <Ionicons name="trash-outline" size={18} color={COLORS.error} />
        <Text style={{ color: COLORS.error, fontSize: 14, marginLeft: 6 }}>重置所有数据</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  name: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  age: { fontSize: 15, color: COLORS.textSecondary, marginTop: 4 },
  editBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primaryLight, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, gap: 4, marginTop: 12 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 16, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, shadowOffset: { width: 0, height: 2 }, shadowColor: '#000' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F5F0EB' },
  infoLabel: { fontSize: 14, color: COLORS.textSecondary },
  infoValue: { fontSize: 14, fontWeight: '500', color: COLORS.text },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.text },
  btn: { backgroundColor: COLORS.primary, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  resetBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 16, marginTop: 8, gap: 4 },
});
