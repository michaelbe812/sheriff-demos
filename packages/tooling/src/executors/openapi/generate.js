// Executor @blueprint/tooling:openapi-generate. Options = ClientDefinition (built by the crystal plugin
// from openapi-clients.json + the client folder). Facade: packages/tooling/src/openapi/facade.mjs.
const { join } = require('path');
const { pathToFileURL } = require('url');

async function openapiGenerateExecutor(client, context) {
  const { generateClient } = await import(pathToFileURL(join(__dirname, '../../openapi/facade.mjs')).href);
  try {
    const written = await generateClient(client, context.root);
    console.log(`${context.projectName}: ${client.generator.adapter} → ${JSON.stringify(written)} files`);
    return { success: true };
  } catch (error) {
    console.error(error.message);
    return { success: false };
  }
}

module.exports = openapiGenerateExecutor;
module.exports.default = openapiGenerateExecutor;
