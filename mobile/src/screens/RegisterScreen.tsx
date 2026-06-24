import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants';
import type { AuthStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Register'>;

export default function RegisterScreen() {
  const nav = useNavigation<Nav>();
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPw: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) { Alert.alert('提示', '请填写所有必填项'); return; }
    if (form.password !== form.confirmPw) { Alert.alert('提示', '两次密码不一致'); return; }
    if (form.password.length < 6) { Alert.alert('提示', '密码至少6位'); return; }
    try {
      setLoading(true);
      await register(form.name.trim(), form.email.trim(), form.password);
    } catch (e: any) { Alert.alert('注册失败', e.message || '请稍后重试');
    } finally { setLoading(false); }
  };

  const field = (icon: any, placeholder: string, key: string, opt?: any) => (
    <View style={st.inputBox} key={key}>
      <Ionicons name={icon} size={20} color={COLORS.textSecondary} />
      <TextInput style={st.input} placeholder={placeholder} placeholderTextColor={COLORS.textTertiary}
        value={(form as any)[key]} onChangeText={(v) => setForm({ ...form, [key]: v })} {...opt} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={st.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={st.ct}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => nav.goBack()}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <Text style={st.headerTitle}>创建账号</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={st.form}>
          {field('person-outline', '姓名', 'name')}
          {field('mail-outline', '邮箱', 'email', { keyboardType: 'email-address', autoCapitalize: 'none' })}
          <View style={st.inputBox}>
            <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} />
            <TextInput style={st.input} placeholder="密码（至少6位）" placeholderTextColor={COLORS.textTertiary}
              value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry={!showPw} autoCapitalize="none" />
            <TouchableOpacity onPress={() => setShowPw(!showPw)}>
              <Ionicons name={showPw ? 'eye-outline' : 'eye-off-outline'} size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          {field('shield-checkmark-outline', '确认密码', 'confirmPw', { secureTextEntry: !showPw })}
          <TouchableOpacity style={[st.btn, loading && { opacity: 0.7 }]} onPress={handle} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={st.btnText}>注 册</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={st.linkBox} onPress={() => nav.goBack()}>
            <Text style={st.linkText}>已有账号？<Text style={{ color: COLORS.primary, fontWeight: '600' }}>返回登录</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const st = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  ct: { flexGrow: 1, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, marginTop: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  form: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 24, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4, shadowOffset: { width: 0, height: 2 }, shadowColor: '#000' },
  inputBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, marginBottom: 14, backgroundColor: COLORS.background, height: 50 },
  input: { flex: 1, marginLeft: 10, fontSize: 16, color: COLORS.text },
  btn: { backgroundColor: COLORS.primary, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 6 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  linkBox: { alignItems: 'center', marginTop: 18 },
  linkText: { fontSize: 14, color: COLORS.textSecondary },
});
