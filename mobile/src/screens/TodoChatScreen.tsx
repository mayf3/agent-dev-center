import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import * as llmApi from '../api/llmtodo';
import type { ChatMessage } from '../api/llmtodo';

interface DisplayMessage extends ChatMessage {
  id: string;
  time: string;
}

export default function TodoChatScreen() {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    { id: 'welcome', role: 'assistant', content: '你好！我是 LLM Todo 规划助手。\n\n你可以让我：\n• 新增任务（"新增 完成项目文档"）\n• 完成任务（"完成 文档编写"）\n• 查看下一步（"下一步"）\n• 讨论规划', time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg: DisplayMessage = { id: Date.now().toString(), role: 'user', content: text, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput('');
    setSending(true);
    try {
      const chatMsgs: ChatMessage[] = newMsgs.map((m) => ({ role: m.role, content: m.content }));
      const res = await llmApi.sendChat(chatMsgs);
      const botMsg: DisplayMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: res.text, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) };
      setMessages([...newMsgs, botMsg]);
    } catch {
      const errMsg: DisplayMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: '❌ 请求失败，请检查网络连接。', time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) };
      setMessages([...newMsgs, errMsg]);
    } finally { setSending(false); setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100); }
  };

  const renderItem = ({ item }: { item: DisplayMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[msg.row, isUser && { justifyContent: 'flex-end' }]}>
        {!isUser && <View style={msg.avatar}><Ionicons name="sparkles" size={16} color="#fff" /></View>}
        <View style={[msg.bubble, isUser ? msg.userBubble : msg.botBubble]}>
          <Text style={[msg.text, isUser && { color: '#fff' }]}>{item.content}</Text>
          <Text style={[msg.time, isUser && { color: 'rgba(255,255,255,0.6)' }]}>{item.time}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList ref={flatRef} data={messages} keyExtractor={(x) => x.id} renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })} />
      {sending && <ActivityIndicator size="small" color={COLORS.primary} style={{ alignSelf: 'center', marginBottom: 4 }} />}
      <View style={msg.bar}>
        <TextInput style={msg.input} placeholder="输入消息..." placeholderTextColor={COLORS.textTertiary}
          value={input} onChangeText={setInput} onSubmitEditing={send} returnKeyType="send" editable={!sending} />
        <TouchableOpacity style={[msg.btn, (!input.trim() || sending) && { opacity: 0.4 }]} onPress={send} disabled={!input.trim() || sending}>
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
const msg = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginRight: 8, marginBottom: 2 },
  bubble: { maxWidth: '75%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  text: { fontSize: 15, color: COLORS.text, lineHeight: 22 },
  time: { fontSize: 11, color: COLORS.textTertiary, marginTop: 4 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, gap: 8 },
  input: { flex: 1, height: 42, borderRadius: 21, backgroundColor: COLORS.background, paddingHorizontal: 16, fontSize: 15, color: COLORS.text },
  btn: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
});
