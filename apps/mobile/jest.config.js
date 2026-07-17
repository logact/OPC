const path = require('path');
const reactNativeDir = path.dirname(require.resolve('react-native'));
const jestPresetDir = path.dirname(require.resolve('@react-native/jest-preset'));

module.exports = {
  haste: {
    defaultPlatform: 'ios',
    platforms: ['android', 'ios', 'native'],
  },
  moduleNameMapper: {
    '^react-native($|/.*)': `${reactNativeDir}/$1`,
    '^react-native-config$': '<rootDir>/src/__mocks__/react-native-config.js',
    '^react-native-encrypted-storage$': '<rootDir>/src/__mocks__/react-native-encrypted-storage.js',
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/__mocks__/@react-native-async-storage/async-storage.js',
    '^react-native-safe-area-context$': 'react-native-safe-area-context/jest/mock',
  },
  resolver: path.join(jestPresetDir, 'jest/resolver.js'),
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest',
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$': path.join(
      jestPresetDir,
      'jest/assetFileTransformer.js',
    ),
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-config|react-native-encrypted-storage|@react-native-async-storage)/)',
  ],
  setupFiles: [],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  testEnvironment: path.join(jestPresetDir, 'jest/react-native-env.js'),
};
