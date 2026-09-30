/**
 * Exported symbols are named after their file, layer, scope and feat (all from the lib path via
 * @blueprint/tooling-conventions) — exactly what the generators write:
 *   `<name>.store.ts`      → class `<Name>Store`; a `*Store` class lives in a `.store.ts`
 *   `<name>-api.ts`        → class `<Name>Api`;   an `*Api` class lives in a `-api.ts`
 *   feature `feat-<f>.ts`  → container `Feat<F>` of the lib's feat; a `Feat*` class lives there
 *   @Component `<name>.ts` → class `<Name>` (or `<Prefix><Name>`, e.g. `AppButton`), selector `<prefix>-<name>`
 *   shell `<scope>.routes|providers|shell.ts`, routes const `<scope>Routes`, providers `provide<X>()`
 *   testing `.fixture.ts` → `a<X>()`/`an<X>()`, `<name>.handlers.ts` → `<name>Handlers` (+ `<name>Scenarios`)
 * No autofix: every checked symbol is exported, a rename in one file would break its importers.
 * Component class and selector come with a suggestion (IDE quick fix, applied on purpose only).
 */
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { LIBS_DIR } from '@blueprint/tooling-conventions';
import { createRule } from '../create-rule';
import { type BlueprintSettings, camelCase, type LibFile, parseLibFile, pascalCase } from '../lib-file';

export const RULE_NAME = 'layer-symbol-naming';

type MessageIds =
  | 'storeClass'
  | 'storeFile'
  | 'apiClass'
  | 'apiFile'
  | 'featFile'
  | 'featClass'
  | 'featClassFile'
  | 'componentClass'
  | 'componentSelector'
  | 'renameClass'
  | 'renameSelector'
  | 'sliceFile'
  | 'routesExport'
  | 'routesMissing'
  | 'providerName'
  | 'fixtureName'
  | 'handlersExport'
  | 'handlersMissing';

type Options = [{ selectorPrefix?: string }];

interface Exported {
  classes: TSESTree.ClassDeclaration[];
  /** function declarations and `const x = () => …` */
  functions: TSESTree.Identifier[];
  /** every other exported const */
  consts: TSESTree.Identifier[];
}

const FUNCTION_INITS: string[] = [AST_NODE_TYPES.ArrowFunctionExpression, AST_NODE_TYPES.FunctionExpression];

function collectExports(program: TSESTree.Program): Exported {
  const exported: Exported = { classes: [], functions: [], consts: [] };
  for (const statement of program.body) {
    const declaration =
      statement.type === AST_NODE_TYPES.ExportNamedDeclaration || statement.type === AST_NODE_TYPES.ExportDefaultDeclaration
        ? statement.declaration
        : null;
    if (!declaration) continue;
    if (declaration.type === AST_NODE_TYPES.ClassDeclaration && declaration.id) exported.classes.push(declaration);
    if (declaration.type === AST_NODE_TYPES.FunctionDeclaration && declaration.id) exported.functions.push(declaration.id);
    if (declaration.type === AST_NODE_TYPES.VariableDeclaration) {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== AST_NODE_TYPES.Identifier) continue;
        const isFunction = declarator.init && FUNCTION_INITS.includes(declarator.init.type);
        (isFunction ? exported.functions : exported.consts).push(declarator.id);
      }
    }
  }
  return exported;
}

/** `@Component({ selector: '…' })` → the selector literal; null = no component, undefined = no string selector */
function componentSelector(cls: TSESTree.ClassDeclaration): TSESTree.StringLiteral | null | undefined {
  const decorator = cls.decorators.find(
    ({ expression }) =>
      expression.type === AST_NODE_TYPES.CallExpression &&
      expression.callee.type === AST_NODE_TYPES.Identifier &&
      expression.callee.name === 'Component',
  );
  if (!decorator) return null;
  const [metadata] = (decorator.expression as TSESTree.CallExpression).arguments;
  if (metadata?.type !== AST_NODE_TYPES.ObjectExpression) return undefined;
  const selector = metadata.properties.find(
    (property): property is TSESTree.Property =>
      property.type === AST_NODE_TYPES.Property &&
      property.key.type === AST_NODE_TYPES.Identifier &&
      property.key.name === 'selector',
  );
  const value = selector?.value;
  return value?.type === AST_NODE_TYPES.Literal && typeof value.value === 'string' ? (value as TSESTree.StringLiteral) : undefined;
}

/** `BookingCard` → `booking-card` */
const kebabCase = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const isApiFile = (file: LibFile): boolean => file.kind === undefined && file.name.endsWith('-api');
const isFeatFile = (file: LibFile): boolean =>
  file.lib.layer === 'feature' && file.lib.feat !== undefined && file.kind === undefined && file.name.startsWith('feat-');

export const layerSymbolNaming = createRule<Options, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: { description: 'Exported symbols are named after their file, layer, scope and feat (blueprint naming scheme).' },
    schema: [
      {
        type: 'object',
        properties: { selectorPrefix: { type: 'string', description: 'Component selector prefix (Angular project `prefix`).' } },
        additionalProperties: false,
      },
    ],
    messages: {
      storeClass: 'Store class in "{{file}}" must be named "{{expected}}", not "{{name}}".',
      storeFile: 'Store class "{{name}}" belongs into "{{expected}}" (stores live in <name>.store.ts).',
      apiClass: 'Class in "{{file}}" must be named "{{expected}}", not "{{name}}".',
      apiFile: 'Class "{{name}}" belongs into "{{expected}}" (Api classes live in <name>-api.ts).',
      featFile: 'Feat container file of {{lib}} must be "{{expected}}", not "{{file}}".',
      featClass: 'Feat container in "{{file}}" must be named "{{expected}}", not "{{name}}".',
      featClassFile: 'Class "{{name}}" looks like a feat container — it belongs into feat-<feat>.ts of a feature lib.',
      componentClass: 'Component class in "{{file}}" must be named "{{expected}}", not "{{name}}".',
      componentSelector: 'Component selector in "{{file}}" must be "{{expected}}", not "{{selector}}".',
      renameClass: 'Rename the class to "{{expected}}" (update its importers).',
      renameSelector: 'Change the selector to "{{expected}}" (update the templates using it).',
      sliceFile: 'Shell file "{{file}}" of {{lib}} must be named after its scope: "{{expected}}".',
      routesExport: 'Routes of {{lib}} must be exported as "{{expected}}", not "{{name}}".',
      routesMissing: '"{{file}}" must export the slice routes as "{{expected}}".',
      providerName: 'Provider function "{{name}}" must be named provide<Name>() (e.g. "{{expected}}").',
      fixtureName: 'Fixture factory "{{name}}" must be named a<Entity>() / an<Entity>() (e.g. "aBooking").',
      handlersExport: 'Handlers file "{{file}}" exports "{{expected}}", not "{{name}}".',
      handlersMissing: '"{{file}}" must export the happy-path handlers as "{{expected}}".',
    },
  },
  defaultOptions: [{ selectorPrefix: 'app' }],
  create(context, [{ selectorPrefix = 'app' }]) {
    const parsed = parseLibFile(context.filename, context.settings as BlueprintSettings);
    // specs export nothing, index.ts only re-exports
    if (!parsed || parsed.spec || parsed.publicApi) return {};
    const file: LibFile = parsed;
    const lib = `${LIBS_DIR}/${file.libPath}`;
    const { scope, layer, feat } = file.lib;

    function checkClass(cls: TSESTree.ClassDeclaration): void {
      const id = cls.id as TSESTree.Identifier;
      const name = id.name;
      const report = (messageId: MessageIds, data: Record<string, string>): void =>
        context.report({ node: id, messageId, data: { file: file.fileName, name, lib, ...data } });

      if (file.kind === 'store') {
        const expected = pascalCase(file.base);
        if (name !== expected) report('storeClass', { expected });
      } else if (/[a-z0-9]Store$/.test(name)) {
        report('storeFile', { expected: `${kebabCase(name.slice(0, -'Store'.length))}.store.ts` });
      }

      if (isApiFile(file)) {
        const expected = pascalCase(file.name);
        if (name !== expected) report('apiClass', { expected });
      } else if (/[a-z0-9]Api$/.test(name)) {
        report('apiFile', { expected: `${kebabCase(name.slice(0, -'Api'.length))}-api.ts` });
      }

      const featFile = isFeatFile(file);
      if (featFile) {
        const expected = `Feat${pascalCase(feat as string)}`;
        if (name !== expected) report('featClass', { expected });
      } else if (/^Feat[A-Z]/.test(name)) {
        report('featClassFile', {});
      }

      const selector = componentSelector(cls);
      if (selector === null) return;
      const expectedClass = pascalCase(file.base);
      // feat containers are already checked against the feat name (same expectation, one message)
      if (!featFile && ![expectedClass, pascalCase(`${selectorPrefix}-${file.base}`)].includes(name)) {
        context.report({
          node: id,
          messageId: 'componentClass',
          data: { file: file.fileName, name, expected: expectedClass },
          suggest: [
            { messageId: 'renameClass', data: { expected: expectedClass }, fix: (fixer) => fixer.replaceText(id, expectedClass) },
          ],
        });
      }
      // a foreign prefix is @angular-eslint/component-selector's finding — only the part after it is checked here
      const expectedSelector = `${selectorPrefix}-${file.base.replaceAll('.', '-')}`;
      if (selector && selector.value.startsWith(`${selectorPrefix}-`) && selector.value !== expectedSelector) {
        context.report({
          node: selector,
          messageId: 'componentSelector',
          data: { file: file.fileName, selector: selector.value, expected: expectedSelector },
          suggest: [
            {
              messageId: 'renameSelector',
              data: { expected: expectedSelector },
              fix: (fixer) => fixer.replaceText(selector, `'${expectedSelector}'`),
            },
          ],
        });
      }
    }

    function checkFeatFileName(node: TSESTree.Program): void {
      const expected = `feat-${feat}.ts`;
      if (isFeatFile(file) && file.name !== `feat-${feat}`) {
        context.report({ node, loc: { line: 1, column: 0 }, messageId: 'featFile', data: { file: file.fileName, lib, expected } });
      }
    }

    function checkShell(node: TSESTree.Program, exported: Exported): void {
      if (layer !== 'shell' || !['routes', 'providers', 'shell'].includes(file.kind ?? '')) return;
      if (file.name !== scope) {
        const expected = `${scope}.${file.kind}.ts`;
        context.report({ node, loc: { line: 1, column: 0 }, messageId: 'sliceFile', data: { file: file.fileName, lib, expected } });
      }
      if (file.kind === 'routes') {
        const expected = `${camelCase(scope)}Routes`;
        const routes = exported.consts.filter(({ name }) => name.endsWith('Routes'));
        for (const id of routes.filter(({ name }) => name !== expected)) {
          context.report({ node: id, messageId: 'routesExport', data: { lib, name: id.name, expected } });
        }
        if (routes.length === 0) {
          context.report({ node, loc: { line: 1, column: 0 }, messageId: 'routesMissing', data: { file: file.fileName, expected } });
        }
      }
      if (file.kind === 'providers') {
        for (const id of exported.functions.filter(({ name }) => !/^provide[A-Z]/.test(name))) {
          context.report({ node: id, messageId: 'providerName', data: { name: id.name, expected: `provide${pascalCase(scope)}` } });
        }
      }
    }

    function checkTesting(node: TSESTree.Program, exported: Exported): void {
      if (file.kind === 'fixture') {
        for (const id of exported.functions.filter(({ name }) => !/^an?[A-Z]/.test(name))) {
          context.report({ node: id, messageId: 'fixtureName', data: { name: id.name } });
        }
      }
      if (file.kind === 'handlers') {
        const expected = { Handlers: `${camelCase(file.name)}Handlers`, Scenarios: `${camelCase(file.name)}Scenarios` };
        for (const [suffix, expectedName] of Object.entries(expected)) {
          for (const id of exported.consts.filter(({ name }) => name.endsWith(suffix) && name !== expectedName)) {
            context.report({ node: id, messageId: 'handlersExport', data: { file: file.fileName, name: id.name, expected: expectedName } });
          }
        }
        if (!exported.consts.some(({ name }) => name === expected.Handlers)) {
          context.report({
            node,
            loc: { line: 1, column: 0 },
            messageId: 'handlersMissing',
            data: { file: file.fileName, expected: expected.Handlers },
          });
        }
      }
    }

    return {
      Program(node) {
        const exported = collectExports(node);
        exported.classes.forEach(checkClass);
        checkFeatFileName(node);
        checkShell(node, exported);
        checkTesting(node, exported);
      },
    };
  },
});
