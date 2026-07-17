export type RootStackParamList = {
  Login: undefined;
  RoomList: undefined;
  Chat: { roomId: string; roomName: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
