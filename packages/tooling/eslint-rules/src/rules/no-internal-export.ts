/**
 * Public API = `src/index.ts`; `internal/` is lib-private, so index.ts must neither re-export nor
 * import from it (`export * from './internal/…'`, `import { x } from './internal/…'; export { x }`).
 * Deep imports into a lib are already blocked by `no-restricted-imports` (eslint.config.mjs).
 * No autofix: removing an export changes the lib's API — a decision, not a formatting fix.
 */
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { INTERNAL_FOLDER, LIBS_DIR } from '@blueprint/tooling-conventions';
import { createRule } from '../create-rule';
import { type BlueprintSettings, parseLibFile } from '../lib-file';

export const RULE_NAME = 'no-internal-export';

const isInternal = (source: string): boolean => source.startsWith('.') && source.split('/').includes(INTERNAL_FOLDER);

export const noInternalExport = createRule<[], 'internalExport'>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: { description: 'The public API (src/index.ts) exposes nothing from internal/.' },
    schema: [],
    messages: {
      internalExport:
        '{{lib}}/src/index.ts must not expose "{{source}}": internal/ is lib-private. Move the file out of internal/ if it is public API.',
    },
  },
  defaultOptions: [],
  create(context) {
    const file = parseLibFile(context.filename, context.settings as BlueprintSettings);
    if (!file?.publicApi) return {};
    const check = (node: { source: TSESTree.StringLiteral | null }): void => {
      if (node.source && isInternal(node.source.value)) {
        context.report({
          node: node.source,
          messageId: 'internalExport',
          data: { lib: `${LIBS_DIR}/${file.libPath}`, source: node.source.value },
        });
      }
    };
    return {
      [AST_NODE_TYPES.ExportAllDeclaration]: check,
      [AST_NODE_TYPES.ExportNamedDeclaration]: check,
      [AST_NODE_TYPES.ImportDeclaration]: check,
    };
  },
});
