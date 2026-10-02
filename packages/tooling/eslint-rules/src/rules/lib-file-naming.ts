/**
 * File and folder names inside a lib match its layer (FILE_KINDS in @blueprint/tooling-conventions):
 * `booking.store.ts` only in data/ui/feature, `booking.routes.ts` only in shell, slice types/utils
 * only kind files, fixtures in `fixtures/`, everything kebab-case. No autofix: ESLint cannot rename files.
 */
import {
  FILE_KINDS,
  KEBAB_CASE,
  KIND_FOLDERS,
  KIND_ONLY_LAYERS,
  LIBS_DIR,
  SHARED_SCOPE,
} from '@blueprint/tooling-conventions';
import { createRule } from '../create-rule';
import { type BlueprintSettings, type LibFile, parseLibFile } from '../lib-file';

export const RULE_NAME = 'lib-file-naming';

type MessageIds = 'folderCase' | 'fileCase' | 'unknownKind' | 'kindLayer' | 'plainFile' | 'kindFolder';

const kindsOf = (layer: string): string[] =>
  Object.entries(FILE_KINDS)
    .filter(([, layers]) => layers.includes(layer))
    .map(([kind]) => kind);

const example = (file: LibFile, kind: string): string => `${file.name}.${kind}.ts`;

/** First naming problem of the file, if any (one message per file is enough to act on). */
function findProblem(file: LibFile): { messageId: MessageIds; data: Record<string, string> } | undefined {
  const lib = `${LIBS_DIR}/${file.libPath}`;
  const folder = file.folders.find((segment) => !KEBAB_CASE.test(segment));
  if (folder) return { messageId: 'folderCase', data: { folder } };
  if (!KEBAB_CASE.test(file.name)) return { messageId: 'fileCase', data: { file: file.fileName, name: file.name } };
  const { kind } = file;
  const { layer, scope } = file.lib;
  if (kind === undefined) {
    if (!KIND_ONLY_LAYERS.includes(layer) || scope === SHARED_SCOPE) return undefined;
    const kinds = kindsOf(layer);
    return {
      messageId: 'plainFile',
      data: { file: file.fileName, layer, lib, expected: kinds.map((k) => example(file, k)).join(' | ') },
    };
  }
  const layers = FILE_KINDS[kind];
  if (!layers) {
    const allowed = kindsOf(layer);
    return {
      messageId: 'unknownKind',
      data: {
        file: file.fileName,
        kind,
        layer,
        allowed: [`${file.name}.ts`, ...allowed.map((k) => example(file, k))].join(' | '),
      },
    };
  }
  if (!layers.includes(layer)) {
    return { messageId: 'kindLayer', data: { file: file.fileName, kind, layer, lib, layers: layers.join('/') } };
  }
  const requiredFolder = KIND_FOLDERS[kind];
  if (requiredFolder && file.folders.at(-1) !== requiredFolder) {
    return { messageId: 'kindFolder', data: { file: file.fileName, folder: requiredFolder } };
  }
  return undefined;
}

export const libFileNaming = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: { description: 'File and folder names inside a lib match its layer (blueprint naming scheme).' },
    schema: [],
    messages: {
      folderCase: 'Folder "{{folder}}" must be kebab-case (e.g. "check-booking").',
      fileCase: 'File "{{file}}": name "{{name}}" must be kebab-case (e.g. "booking-card.ts").',
      unknownKind:
        'File "{{file}}": ".{{kind}}.ts" is no blueprint file kind. In a {{layer}} lib use {{allowed}} (kinds: packages/tooling/conventions → FILE_KINDS).',
      kindLayer: 'File "{{file}}": ".{{kind}}.ts" belongs into a {{layers}} lib, not into {{lib}} ({{layer}}).',
      plainFile: 'File "{{file}}": files of a {{layer}} lib carry their kind — {{expected}} ({{lib}}).',
      kindFolder: 'File "{{file}}" belongs into the folder "{{folder}}/" below src/.',
    },
  },
  defaultOptions: [],
  create(context) {
    const file = parseLibFile(context.filename, context.settings as BlueprintSettings);
    if (!file || file.publicApi) return {};
    return {
      Program() {
        const problem = findProblem(file);
        // start of the file: the name is the problem, not a statement
        if (problem) context.report({ loc: { line: 1, column: 0 }, ...problem });
      },
    };
  },
});
