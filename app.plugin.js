// Entry point for this project's config plugins.
// Expo resolves `./app.plugin.js` from the `plugins` array in app.json.
const withOverlayPermissions = require('./plugins/withOverlayPermissions');
const withReleaseSigning = require('./plugins/withReleaseSigning');

module.exports = (config) => withReleaseSigning(withOverlayPermissions(config));
