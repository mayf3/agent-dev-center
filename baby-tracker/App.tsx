import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import DashboardScreen from './src/screens/DashboardScreen';
import ActivitiesScreen from './src/screens/ActivitiesScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { COLORS } from './src/constants';

type TabParamList = {
  Dashboard: undefined;
  Activities: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const tabIcons: Record<keyof TabParamList, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Dashboard: { active: 'stats-chart', inactive: 'stats-chart-outline' },
  Activities: { active: 'sparkles', inactive: 'sparkles-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Tab.Navigator screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: COLORS.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          tabBarIcon: ({ focused, size }) => {
            const icons = tabIcons[route.name as keyof TabParamList];
            return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={COLORS.primary} />;
          },
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textSecondary,
          tabBarStyle: { paddingBottom: 5, height: 60 },
        })}>
          <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: '评估', headerTitle: '👶 能力评估' }} />
          <Tab.Screen name="Activities" component={ActivitiesScreen} options={{ title: '活动', headerTitle: '🎮 每日活动' }} />
          <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: '宝宝', headerTitle: '👧 宝宝档案' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
