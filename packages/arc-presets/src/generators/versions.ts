/** Pinned dependency versions the init generator installs into a target repo. */

// The @lambda-solutions fork — published v1 on npm.
export const FORK_CORE = '@lambda-solutions/sheriff-core';
export const FORK_ESLINT = '@lambda-solutions/eslint-plugin-sheriff';
export const FORK_VERSION = '^1.0.0';

// Upstream, for presets that do not need the fork.
export const UPSTREAM_CORE = '@softarc/sheriff-core';
export const UPSTREAM_ESLINT = '@softarc/eslint-plugin-sheriff';
export const UPSTREAM_VERSION = '^0.19.6';

export const TS_ESLINT_UTILS = '@typescript-eslint/utils';
export const TS_ESLINT_UTILS_VERSION = '^8.0.0';
