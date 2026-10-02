import { formatFiles, logger, names, Tree } from '@nx/devkit';
import { detectPreset } from '../detect-preset';

export interface SharedFeatureGeneratorSchema {
  name: string;
  /** App name: scaffold under apps/<app>/src/app/<name>. Omit for a lib under libs/<name>/src. */
  app?: string;
  /** Override the detected preset. */
  preset?: 'blueprint' | 'inverted';
}

export default async function sharedFeatureGenerator(
  tree: Tree,
  options: SharedFeatureGeneratorSchema,
): Promise<void> {
  const detected = detectPreset(tree, options.preset);
  if (detected !== 'blueprint' && detected !== 'inverted') {
    throw new Error(
      `The 'shared-feature' generator is for the vertical-slice presets, but the active preset is '${detected}'. Hexagonal presets have no shared-feature concept — use 'app/shared/*' or a shared lib instead.`,
    );
  }

  const { className, fileName, propertyName, constantName } = names(
    options.name,
  );

  const root = options.app
    ? `apps/${options.app}/src/app/${fileName}`
    : `libs/${fileName}/src`;

  // Port = contract only (token + interface); impl is wired at the slice root.
  tree.write(
    `${root}/api/${fileName}-api.ts`,
    `import { InjectionToken } from '@angular/core';

/**
 * PORT of the ${fileName} shared-feature: contract only (token + interfaces).
 * The implementation (type:state) is wired at the slice root via
 * provide${className}() — consumers inject ${constantName}_API and never see the store.
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
import { ${className}Api } from '../api/${fileName}-api';

@Injectable({ providedIn: 'root' })
export class ${className}Store implements ${className}Api {
  readonly ready = true;
}
`,
  );
  tree.write(
    `${root}/${fileName}.providers.ts`,
    `import { Provider } from '@angular/core';
import { ${constantName}_API } from './api/${fileName}-api';
import { ${className}Store } from './state/${fileName}.store';

/** Slice root (entry, type:feature): wires the port contract to its impl. */
export function provide${className}(): Provider {
  return { provide: ${constantName}_API, useExisting: ${className}Store };
}
`,
  );

  logger.warn(
    `arc-presets: add '${propertyName}' to sharedFeatures in sheriff.config.ts — otherwise the slice is untagged (noTag).`,
  );
  await formatFiles(tree);
}
