import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants';

interface Props {
  data: { label: string; score: number; color: string }[];
  size?: number;
}

export default function RadarChart({ data, size = 200 }: Props) {
  const center = size / 2;
  const radius = size * 0.38;
  const levels = 5;
  const angleStep = (Math.PI * 2) / data.length;

  if (data.length === 0) return null;

  // 生成网格多边形路径
  const gridPolygons = [];
  for (let l = 1; l <= levels; l++) {
    const r = (radius / levels) * l;
    const pts = data.map((_, i) => {
      const a = -Math.PI / 2 + i * angleStep;
      return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
    }).join(' ');
    gridPolygons.push(pts);
  }

  // 数据多边形
  const dataPts = data.map((d, i) => {
    const a = -Math.PI / 2 + i * angleStep;
    const r = (d.score / levels) * radius;
    return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
  }).join(' ');

  // 标签位置
  const labels = data.map((d, i) => {
    const a = -Math.PI / 2 + i * angleStep;
    const r = radius + 22;
    return { x: center + r * Math.cos(a), y: center + r * Math.sin(a), label: d.label };
  });

  return (
    <View style={{ alignItems: 'center', marginVertical: 8 }}>
      <svg width={size + 50} height={size + 50} viewBox={`0 0 ${size + 50} ${size + 50}`}>
        {/* 背景网格 */}
        {gridPolygons.map((pts, i) => (
          <polygon key={i} points={pts} fill="none" stroke={COLORS.border} strokeWidth={1} />
        ))}
        {/* 轴线 */}
        {data.map((_, i) => {
          const a = -Math.PI / 2 + i * angleStep;
          return <line key={i} x1={center} y1={center} x2={center + radius * Math.cos(a)} y2={center + radius * Math.sin(a)} stroke={COLORS.border} strokeWidth={1} />;
        })}
        {/* 数据区域 */}
        <polygon points={dataPts} fill="rgba(255,107,157,0.2)" stroke={COLORS.primary} strokeWidth={2} />
        {/* 数据点 */}
        {data.map((d, i) => {
          const a = -Math.PI / 2 + i * angleStep;
          const r = (d.score / levels) * radius;
          return <circle key={i} cx={center + r * Math.cos(a)} cy={center + r * Math.sin(a)} r={3} fill={COLORS.primary} />;
        })}
        {/* 标签 */}
        {labels.map((l, i) => (
          <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize={10} fill={COLORS.textSecondary}>{l.label.length > 4 ? l.label.substring(0, 4) : l.label}</text>
        ))}
      </svg>
      <Text style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 4 }}>1-5 分雷达图</Text>
    </View>
  );
}

// 需要在文件中包含 svg 元素支持
// 由于 React Native 中 svg 需要单独处理，这里用一个简化文字版
export function RadarChartTextView({ data, size = 200 }: Props) {
  const rows = [];
  for (let i = 0; i < data.length; i += 2) {
    const left = data[i];
    const right = data[i + 1];
    rows.push(
      <View key={i} style={{ flexDirection: 'row', marginBottom: 6 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          <View style={[s.dot, { backgroundColor: left.color }]} />
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, flex: 1 }}>{left.label}</Text>
          <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }}>
            {'★'.repeat(left.score)}{'☆'.repeat(5 - left.score)}
          </Text>
        </View>
        {right && (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
            <View style={[s.dot, { backgroundColor: right.color }]} />
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, flex: 1 }}>{right.label}</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }}>
              {'★'.repeat(right.score)}{'☆'.repeat(5 - right.score)}
            </Text>
          </View>
        )}
      </View>
    );
  }
  return <View style={{ paddingVertical: 8 }}>{rows}</View>;
}
const s = StyleSheet.create({ dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 } });

// Polyfill svg with View components for RN (react-native-svg imported dynamically)
let svg: any, circle: any, polygon: any, line: any, text: any;
try {
  const Svg = require('react-native-svg');
  svg = Svg.Svg;
  circle = Svg.Circle;
  polygon = Svg.Polygon;
  line = Svg.Line;
  text = Svg.Text;
} catch {}
