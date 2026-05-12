import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants';
import type { AuthStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export default function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { Alert.alert('提示', '请输入邮箱和密码'); return; }
    try {
      setLoading(true);
      await login(email.trim(), password);
    } catch (e: any) {
      Alert.alert('登录失败', e.message || '请检查邮箱和密码');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.ct}>
        <View style={s.logoSection}>
          <View style={s.logo}><Ionicons name="flash" size={44} color="#fff" /></View>
          <Text style={s.title}>Agent开发中心</Text>
          <Text style={s.sub}>需求驱动的开发管理平台</Text>
        </View>
        <View style={s.form}>
          <View style={s.inputBox}>
            <Ionicons name="mail-outline" size={20} color={COLORS.textSecondary} />
            <TextInput style={s.input} placeholder="邮箱" placeholderTextColor={COLORS.textTertiary}
              value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          </View>
          <View style={s.inputBox}>
            <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} />
            <TextInput style={s.input} placeholder="密码" placeholderTextColor={COLORS.textTertiary}
              value={password} onChangeText={setPassword} secureTextEntry={!showPw} autoCapitalize="none" />
            <TouchableOpacity onPress={() => setShowPw(!showPw)}>
              <Ionicons name={showPw ? 'eye-outline' : 'eye-off-outline'} size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[s.btn, loading && { opacity: 0.7 }]} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>登 录</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBox} onPress={() => navigation.navigate('Register')}>
            <Text style={s.linkText}>还没有账号？<Text style={{ color: COLORS.primary, fontWeight: '600' }}>立即注册</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  ct: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoSection: { alignItems: 'center', marginBottom: 40 },
  logo: { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 14, shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8, shadowOffset: { width: 0, height: 4 } },
  title: { fontSize: 26, fontWeight: '700', color: COLORS.text },
  sub: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  form: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 24, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4, shadowOffset: { width: 0, height: 2 }, shadowColor: '#000' },
  inputBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, marginBottom: 14, backgroundColor: COLORS.background, height: 50 },
  input: { flex: 1, marginLeft: 10, fontSize: 16, color: COLORS.text },
  btn: { backgroundColor: COLORS.primary, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 6, shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4, shadowOffset: { width: 0, height: 4 } },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  linkBox: { alignItems: 'center', marginTop: 18 },
  linkText: { fontSize: 14, color: COLORS.textSecondary },
});
