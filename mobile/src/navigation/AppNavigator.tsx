import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import DashboardScreen from '../screens/DashboardScreen';
import DemandListScreen from '../screens/DemandListScreen';
import DemandDetailScreen from '../screens/DemandDetailScreen';
import CreateDemandScreen from '../screens/CreateDemandScreen';
import KanbanScreen from '../screens/KanbanScreen';
import ProfileScreen from '../screens/ProfileScreen';

// 类型导出供页面使用
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  DemandDetail: { demandId: string };
  CreateDemand: undefined;
};
export type AuthStackParamList = { Login: undefined; Register: undefined };
export type MainTabParamList = {
  Dashboard: undefined; Demands: undefined; Kanban: undefined; Profile: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthNav = createNativeStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const tabIcons: Record<keyof MainTabParamList, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Dashboard: { active: 'grid', inactive: 'grid-outline' },
  Demands: { active: 'document-text', inactive: 'document-text-outline' },
  Kanban: { active: 'albums', inactive: 'albums-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

const MainTabs = () => (
  <Tab.Navigator screenOptions={({ route }) => ({
    headerStyle: { backgroundColor: COLORS.primary },
    headerTintColor: '#fff',
    headerTitleStyle: { fontWeight: '600' },
    tabBarIcon: ({ focused, color, size }) => {
      const icons = tabIcons[route.name as keyof MainTabParamList];
      return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
    },
    tabBarActiveTintColor: COLORS.primary,
    tabBarInactiveTintColor: COLORS.textSecondary,
    tabBarStyle: { paddingBottom: 5, paddingTop: 5, height: 60 },
  })}>
    <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: '首页', headerTitle: 'Agent开发中心' }} />
    <Tab.Screen name="Demands" component={DemandListScreen} options={{ title: '需求', headerTitle: '需求列表' }} />
    <Tab.Screen name="Kanban" component={KanbanScreen} options={{ title: '看板', headerTitle: '开发看板' }} />
    <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: '我的', headerTitle: '个人中心' }} />
  </Tab.Navigator>
);

const AuthStack = () => (
  <AuthNav.Navigator screenOptions={{ headerShown: false }}>
    <AuthNav.Screen name="Login" component={LoginScreen} />
    <AuthNav.Screen name="Register" component={RegisterScreen} />
  </AuthNav.Navigator>
);

export const AppNavigator = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <RootStack.Screen name="Main" component={MainTabs} />
            <RootStack.Screen name="DemandDetail" component={DemandDetailScreen}
              options={{ headerShown: true, title: '需求详情',
                headerStyle: { backgroundColor: COLORS.primary }, headerTintColor: '#fff' }} />
            <RootStack.Screen name="CreateDemand" component={CreateDemandScreen}
              options={{ headerShown: true, title: '提交需求',
                headerStyle: { backgroundColor: COLORS.primary }, headerTintColor: '#fff' }} />
          </>
        ) : (
          <RootStack.Screen name="Auth" component={AuthStack} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};
