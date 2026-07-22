import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabsParamList = {
  Chats: undefined;
  Contacts: undefined;
  AddAgent: undefined;
  Me: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  MainTabs: NavigatorScreenParams<MainTabsParamList> | undefined;
  Room: { roomId: string; roomName: string };
  RoomInfo: { roomId: string };
  NewGroup: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
