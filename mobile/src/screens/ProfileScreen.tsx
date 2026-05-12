import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { COLORS, ROLE_LABELS } from '../constants';

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  const handleLogout = () => Alert.alert('退出登录', '确定要退出吗？', [
    { text: '取消', style: 'cancel' },
    { text: '确定', style: 'destructive', onPress: logout },
  ]);

  const items = [
    { icon: 'person-outline', label: '个人信息', sub: user?.email },
    { icon: 'shield-outline', label: '角色权限', sub: ROLE_LABELS[user?.role || ''] || user?.role },
    { icon: 'notifications-outline', label: '消息通知', sub: '暂无未读' },
    { icon: 'information-circle-outline', label: '关于', sub: 'v1.0.0' },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={st.header}>
        <View style={st.avatar}><Text style={st.avatarText}>{user?.name?.charAt(0)?.toUpperCase() || 'U'}</Text></View>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 }}>{user?.name || '未知用户'}</Text>
        <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 12 }}>{user?.email || ''}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, gap: 4 }}>
          <Ionicons name="shield-checkmark" size={14} color="#fff" />
          <Text style={{ fontSize: 13, color: '#fff', fontWeight: '500' }}>{ROLE_LABELS[user?.role || ''] || user?.role}</Text>
        </View>
      </View>
      <View style={st.menu}>
        {items.map((item, i) => (
          <TouchableOpacity key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: '#F3F4F6' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Ionicons name={item.icon as any} size={22} color={COLORS.textSecondary} />
              <View style={{ marginLeft: 14, flex: 1 }}>
                <Text style={{ fontSize: 15, color: COLORS.text, fontWeight: '500' }}>{item.label}</Text>
                <Text style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 2 }}>{item.sub}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={st.logout} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={22} color={COLORS.error} />
        <Text style={{ fontSize: 16, color: COLORS.error, fontWeight: '600' }}>退出登录</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
const st = StyleSheet.create({
  header: { alignItems: 'center', paddingVertical: 32, backgroundColor: COLORS.primary, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  menu: { backgroundColor: COLORS.surface, marginHorizontal: 16, marginTop: 16, borderRadius: 16, paddingHorizontal: 16, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, shadowOffset: { width: 0, height: 1 }, shadowColor: '#000' },
  logout: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface, marginHorizontal: 16, marginTop: 16, borderRadius: 16, paddingVertical: 16, gap: 8, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, shadowOffset: { width: 0, height: 1 }, shadowColor: '#000' },
});
