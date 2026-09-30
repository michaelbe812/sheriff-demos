// Nx-Executor `update-spec`: spec.url → spec.file (normalisiertes YAML). Nicht gecacht (Netzwerk).
const { join } = require('path');
const { pathToFileURL } = require('url');

async function updateSpecExecutor(client, context) {
  const { updateSpec } = await import(pathToFileURL(join(__dirname, 'facade.mjs')).href);
  try {
    const { changed } = await updateSpec(client, context.root, context.projectName);
    console.log(`${client.spec.file}: ${changed ? 'aktualisiert' : 'unverändert'} (${client.spec.url})`);
    return { success: true };
  } catch (error) {
    console.error(error.message);
    return { success: false };
  }
}

module.exports = updateSpecExecutor;
module.exports.default = updateSpecExecutor;
