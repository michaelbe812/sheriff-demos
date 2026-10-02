import { formatFiles, logger, names, Tree } from '@nx/devkit';

export interface SharedFeatureGeneratorSchema {
  name: string;
  /** App name: scaffold under apps/<app>/src/app/<name>. Omit for a lib under libs/<name>/src. */
  app?: string;
}

export default async function sharedFeatureGenerator(
  tree: Tree,
  options: SharedFeatureGeneratorSchema,
): Promise<void> {
  const { className, fileName, propertyName } = names(options.name);
  const constantName = names(options.name).constantName;

  const root = options.app
    ? `apps/${options.app}/src/app/${fileName}`
    : `libs/${fileName}/src`;

  // Port = contract only (token + interface); impl is wired at the slice root.
  // In api/index.ts so consumers import the bucket, not a file.
  tree.write(
    `${root}/api/index.ts`,
    `import { InjectionToken } from '@angular/core';

/**
 * PORT of the ${fileName} shared-feature: contract only (token + interfaces).
 * The implementation (type:state) is wired at the slice root via
 * provide${className}() — consumers inject ${constantName}_API and never see the store.
 *
 * Uses the InjectionToken variant deliberately: a shared-feature port is
 * backed by a STORE (\`useExisting\`), so the contract stays a plain interface
 * the store can \`implements\`. Domains use the abstract-class variant instead
 * — see docs/architecture.md.
 */
export interface ${className}Api {
  readonly ready: boolean;
}

export const ${constantName}_API = new InjectionToken<${className}Api>('${constantName}_API');
`,
  );
  tree.write(
    `${root}/state/${fileName}.store.ts`,
    `import { Injectable } from '@angular/core';
import { ${className}Api } from '../api';

@Injectable({ providedIn: 'root' })
export class ${className}Store implements ${className}Api {
  readonly ready = true;
}
`,
  );
  tree.write(
    `${root}/${fileName}.providers.ts`,
    `import { Provider } from '@angular/core';
import { ${constantName}_API } from './api';
import { ${className}Store } from './state/${fileName}.store';

/** Slice root (entry, type:feature): wires the port contract to its impl. */
export function provide${className}(): Provider {
  return { provide: ${constantName}_API, useExisting: ${className}Store };
}
`,
  );

  logger.warn(
    `Blueprint: add '${propertyName}' to sharedFeatures in sheriff.config.ts — otherwise the slice is untagged (noTag).`,
  );
  await formatFiles(tree);
}
