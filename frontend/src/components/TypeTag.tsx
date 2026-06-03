import { Tag } from 'antd';
import type { RequirementType } from '../api/types';
import { typeLabels, typeColors } from '../constants/options';

interface TypeTagProps {
  type?: RequirementType | null;
}

export function TypeTag({ type }: TypeTagProps): JSX.Element | null {
  if (!type) return null;
  return <Tag color={typeColors[type] ?? 'default'}>{typeLabels[type] ?? type}</Tag>;
}
