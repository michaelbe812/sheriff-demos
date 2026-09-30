// Nx-Executor `generate`: Optionen = ClientDefinition (vom Plugin blueprint-openapi-clients aus Ordner + nx.json abgeleitet).
const { join } = require('path');
const { pathToFileURL } = require('url');

async function generateExecutor(client, context) {
  const { generateClient } = await import(pathToFileURL(join(__dirname, 'facade.mjs')).href);
  try {
    const written = await generateClient(client, context.root);
    console.log(`${context.projectName}: ${client.generator.adapter} → ${JSON.stringify(written)} Dateien`);
    return { success: true };
  } catch (error) {
    console.error(error.message);
    return { success: false };
  }
}

module.exports = generateExecutor;
module.exports.default = generateExecutor;
