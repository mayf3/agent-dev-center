import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants';

interface Props {
  data: { label: string; score: number; color: string }[];
}

export default function RadarTextView({ data }: Props) {
  if (data.length === 0) return null;

  return (
    <View style={{ paddingVertical: 8 }}>
      {data.map((item, i) => (
        <View key={i} style={s.row}>
          <View style={s.dotWrapper}>
            <View style={[s.dot, { backgroundColor: item.color }]} />
            <Text style={s.label}>{item.label}</Text>
          </View>
          <View style={{ flexDirection: 'row' }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Text key={star} style={{ fontSize: 16, marginHorizontal: 1, color: star <= item.score ? item.color : COLORS.border }}>
                ★
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F5F0EB' },
  dotWrapper: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  label: { fontSize: 14, color: COLORS.text },
});
