const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Permissions required by the overlay pipeline.
 *
 * SYSTEM_ALERT_WINDOW                  draw the trajectory layer over other apps
 * FOREGROUND_SERVICE                   keep the overlay service alive
 * FOREGROUND_SERVICE_MEDIA_PROJECTION  API 34+ gate for a screen-capture service
 * FOREGROUND_SERVICE_SPECIAL_USE       API 34+ gate for the overlay service itself
 *
 * The last one is not in the original spec but is mandatory: from Android 14,
 * startForeground() throws unless the service's declared foregroundServiceType is
 * backed by a matching permission. The overlay service is not a media-projection
 * service (it only draws), so `specialUse` is the correct type for it, and
 * `specialUse` requires this permission.
 *
 * The matching PROPERTY_SPECIAL_USE_FGS_SUBTYPE declaration lives on the
 * <service> element in modules/overlay-native/android/src/main/AndroidManifest.xml,
 * which is where Android reads it from. This plugin stays permissions-only and is
 * merged into the app manifest during prebuild.
 */
const REQUIRED_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
];

function addPermissions(androidManifest) {
  const manifest = androidManifest.manifest;
  manifest['uses-permission'] = manifest['uses-permission'] || [];

  for (const name of REQUIRED_PERMISSIONS) {
    const exists = manifest['uses-permission'].some(
      (p) => p.$ && p.$['android:name'] === name
    );
    if (!exists) {
      manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
  }
  return androidManifest;
}

/**
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withOverlayPermissions = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = addPermissions(cfg.modResults);
    return cfg;
  });

module.exports = withOverlayPermissions;
module.exports.REQUIRED_PERMISSIONS = REQUIRED_PERMISSIONS;
