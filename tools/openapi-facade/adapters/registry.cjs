// Adapter-Registry: von der Facade (ESM) UND vom Nx-Plugin (sync, CJS) gelesen.
// `packages` und `inputs` landen als Cache-Inputs im generate-Target: Adapter-Version = Paketversion
// (+ z.B. die Jar-Version in openapitools.json). Ein neuer Adapter = ein Eintrag + ein Modul.
module.exports = {
  'openapi-tools': {
    module: './openapi-tools.mjs',
    packages: ['@openapitools/openapi-generator-cli'],
    inputs: ['{workspaceRoot}/openapitools.json'],
    // Java kommt vom System (JRE 11+): Version als Runtime-Input, damit ein JRE-Wechsel neu generiert
    runtime: ['java -version 2>&1'],
  },
  'hey-api': {
    module: './hey-api.mjs',
    packages: ['@hey-api/openapi-ts'],
    inputs: [],
    runtime: [],
  },
  'nx-plugin-openapi': {
    module: './nx-plugin-openapi.mjs',
    // beide Backends als Input: welches läuft, steht in den Optionen (die hasht Nx ohnehin mit)
    packages: [
      '@nx-plugin-openapi/core',
      '@nx-plugin-openapi/plugin-openapi',
      '@nx-plugin-openapi/plugin-hey-api',
      '@openapitools/openapi-generator-cli',
      '@hey-api/openapi-ts',
    ],
    inputs: ['{workspaceRoot}/openapitools.json'],
    runtime: ['java -version 2>&1'],
  },
};
