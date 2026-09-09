module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['inline-import', { extensions: ['.sql'] }],
      // Must be LAST. The worklets plugin rewrites functions marked 'worklet'
      // so they can run on the camera thread; anything added after it here
      // would not get processed.
      'react-native-worklets/plugin',
    ],
  };
};
