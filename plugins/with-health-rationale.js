const { withMainActivity } = require('@expo/config-plugins');

// Both Health Connect permission-rationale intents must open our in-app data
// explanation, including when Android reuses an already running activity.
module.exports = function withHealthRationale(config) {
  return withMainActivity(config, config => {
    let source = config.modResults.contents;
    if (!source.includes('fitnessHealthIntent')) {
      source = source.replace('super.onCreate(null)', 'fitnessHealthIntent(intent)\n    super.onCreate(null)');
      source = source.replace('  override fun getMainComponentName()', `  private fun fitnessHealthIntent(incoming: android.content.Intent?) {
    if (incoming?.action == "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" || incoming?.action == "android.intent.action.VIEW_PERMISSION_USAGE") {
      incoming.action = android.content.Intent.ACTION_VIEW
      incoming.data = android.net.Uri.parse("fitnessrpg://health")
    }
  }

  override fun onNewIntent(intent: android.content.Intent) {
    fitnessHealthIntent(intent)
    super.onNewIntent(intent)
  }

  override fun getMainComponentName()`);
    }
    config.modResults.contents = source;
    return config;
  });
};
