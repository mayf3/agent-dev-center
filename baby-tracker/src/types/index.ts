// 能力维度评分（1-5）
export interface AbilityScore {
  id: string;
  label: string;
  score: 1 | 2 | 3 | 4 | 5;
  notes: string;
  date: string;
}

// 能力类别
export interface AbilityCategory {
  id: string;
  label: string;
  icon: string;
  items: AbilityItem[];
}

export interface AbilityItem {
  id: string;
  label: string;
  desc: string;
  score: number;
}

// 活动
export interface Activity {
  id: string;
  title: string;
  type: 'game' | 'experiment' | 'outdoor' | 'reading' | 'english';
  category: string;
  materials: string[];
  steps: string[];
  duration: string;
  difficulty: 1 | 2 | 3;
  done: boolean;
  date?: string;
  reaction?: string;
}

// 宝宝档案
export interface BabyProfile {
  name: string;
  birthDate: string;
  avatar?: string;
  bloodType?: string;
  allergies: string[];
}

// 观察记录
export interface Observation {
  id: string;
  date: string;
  category: string;
  content: string;
  photos: string[];
}
