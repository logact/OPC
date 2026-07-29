// Jest mock for react-native-safe-area-context: render SafeAreaView as a
// plain View and return zero insets. The upstream jest/mock only provides a
// default export, which breaks the app's named imports.
import { View } from 'react-native';

export const SafeAreaView = View;
export const SafeAreaProvider = View;
export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: 320, height: 640 });
export const initialWindowMetrics = null;
