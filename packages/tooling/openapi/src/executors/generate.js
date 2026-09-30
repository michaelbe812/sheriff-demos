// Executor @blueprint/tooling-openapi:generate. Option `client` = client path below libs/; the definition
// (adapter, options, spec) comes from openapi-clients.json at run time. Facade: src/facade/facade.mjs.
const { join } = require('path');
const { pathToFileURL } = require('url');

async function openapiGenerateExecutor({ client: clientPath }, context) {
  const { generateClient, resolveClient } = await import(
    pathToFileURL(join(__dirname, '../facade/facade.mjs')).href
  );
  try {
    const client = resolveClient(context.root, clientPath);
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
