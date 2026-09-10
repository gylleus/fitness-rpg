const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

// Android 16+ honors game orientation on large displays (including the Fold).
module.exports = function withGameCategory(config) {
  return withAndroidManifest(config, config => {
    AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults).$['android:appCategory'] = 'game';
    return config;
  });
};
