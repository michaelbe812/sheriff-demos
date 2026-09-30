// Executor @blueprint/tooling:openapi-update-spec: spec.url → spec.file (normalized). Not cached (network).
const { join } = require('path');
const { pathToFileURL } = require('url');

async function openapiUpdateSpecExecutor(client, context) {
  const { updateSpec } = await import(pathToFileURL(join(__dirname, '../../openapi/facade.mjs')).href);
  try {
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
