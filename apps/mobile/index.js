/**
 * @format
 */

import './src/polyfills';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Android MainActivity.getMainComponentName() returns "main"; register both
// the native entry name and the app.json name (iOS) so either side finds it.
AppRegistry.registerComponent('main', () => App);
AppRegistry.registerComponent(appName, () => App);
