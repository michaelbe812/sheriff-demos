// Executor @blueprint/tooling:openapi-generate-testing: the client's testing lib (openapi-typescript,
// orval msw mocks, openapi-msw) from its committed spec only. Pipeline: src/openapi/testing/testing.mjs.
const { join } = require('path');
const { pathToFileURL } = require('url');

async function openapiGenerateTestingExecutor({ client: clientPath }, context) {
  const { resolveClient } = await import(pathToFileURL(join(__dirname, '../../openapi/facade.mjs')).href);
  const { generateTestingLib } = await import(pathToFileURL(join(__dirname, '../../openapi/testing/testing.mjs')).href);
  try {
    const { files, baseUrl } = await generateTestingLib(resolveClient(context.root, clientPath), context.root);
    console.log(`${context.projectName}: ${files} files (baseUrl ${JSON.stringify(baseUrl)})`);
    return { success: true };
  } catch (error) {
    console.error(error.message);
    return { success: false };
  }
}

module.exports = openapiGenerateTestingExecutor;
module.exports.default = openapiGenerateTestingExecutor;
