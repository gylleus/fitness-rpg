// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// react-native-fast-tflite loads models via require(), so Metro has to treat
// .tflite as a bundled asset rather than a module it tries to parse. Drizzle's
// Expo migration bundle imports the raw .sql files the same way.
config.resolver.assetExts.push('tflite', 'sql');

module.exports = config;
