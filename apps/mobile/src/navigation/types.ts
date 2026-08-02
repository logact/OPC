import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabsParamList = {
  Chats: undefined;
  Contacts: undefined;
  AddAgent: undefined;
  Org: undefined;
  Tasks: undefined;
  Me: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  MainTabs: NavigatorScreenParams<MainTabsParamList> | undefined;
  Room: { roomId: string; roomName: string };
  RoomInfo: { roomId: string };
  NewGroup: undefined;
  ServerConfig: undefined;
  DepartmentDetail: { departmentId: string };
  DepartmentForm: {
    mode: 'create' | 'edit' | 'move';
    departmentId?: string;
    parentId?: string;
  };
  PositionForm: { departmentId: string; positionId?: string };
  StaffAssignments: { departmentId: string };
  TaskDetail: { taskId: string };
  TaskForm: { taskId?: string };
  TaskAssignment: { taskId: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
