import old from '../old-version.json'

export const APP_VERSION = '25.6.84'

// The old version kept online for anyone who needs it (built at every deploy
// from its commit, at /cartup-ops/old/); this site is always the latest.
export const OLD_VERSION = { version: old.version, path: old.path }
