// Executor @blueprint/tooling-openapi:update-spec: the entry's url (openapi-clients.json) → the committed
// spec file (normalized). Not cached (network). Fails for a client without url.
const { join } = require('path');
const { pathToFileURL } = require('url');

async function openapiUpdateSpecExecutor({ client: clientPath }, context) {
  const { resolveClient, updateSpec } = await import(pathToFileURL(join(__dirname, '../facade/facade.mjs')).href);
  try {
    const client = resolveClient(context.root, clientPath);
    const { changed } = await updateSpec(client, context.root, context.projectName);
    console.log(`${client.spec.file}: ${changed ? 'updated' : 'unchanged'} (${client.spec.url})`);
    return { success: true };
  } catch (error) {
    console.error(error.message);
    return { success: false };
  }
}

module.exports = openapiUpdateSpecExecutor;
module.exports.default = openapiUpdateSpecExecutor;
