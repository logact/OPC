/**
 * @format
 */

import './src/polyfills';

import { AppRegistry, LogBox } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// e2e: the dev warning banner overlays the bottom tab bar and intercepts taps.
LogBox.ignoreAllLogs(true);

// Android MainActivity.getMainComponentName() returns "main"; register both
// the native entry name and the app.json name (iOS) so either side finds it.
AppRegistry.registerComponent('main', () => App);
AppRegistry.registerComponent(appName, () => App);
