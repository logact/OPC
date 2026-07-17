const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro configuration for pnpm monorepo, Expo Bare Workflow and MQTT Node polyfills.
 * https://docs.expo.dev/guides/customizing-metro/
 *
 * @type {import('expo/metro-config').MetroConfig}
 */
const config = getDefaultConfig(__dirname);

config.watchFolders = [
  path.resolve(__dirname, '../..'),
  path.resolve(__dirname, '../../packages'),
];

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../../node_modules'),
];

config.resolver.disableHierarchicalLookup = false;
config.resolver.extraNodeModules = {
  buffer: require.resolve('buffer'),
  events: require.resolve('events'),
  stream: require.resolve('stream-browserify'),
  url: require.resolve('url'),
  path: require.resolve('path-browserify'),
  process: require.resolve('process/browser'),
  util: require.resolve('util'),
  net: require.resolve('react-native-tcp-socket'),
  tls: require.resolve('react-native-tcp-socket'),
};

module.exports = config;
