import { formatFiles, names, Tree } from '@nx/devkit';
import { detectPreset } from '../detect-preset';
import { VerticalPreset, writeFeat } from '../scaffold';

export interface FeatGeneratorSchema {
  name: string;
  domain: string;
  /** App name for an app-internal domain. Omit if the domain is a lib. */
  app?: string;
  /** Override the detected preset. */
  preset?: VerticalPreset;
}

export default async function featGenerator(
  tree: Tree,
  options: FeatGeneratorSchema,
): Promise<void> {
  const detected = detectPreset(tree, options.preset);
  if (detected !== 'blueprint' && detected !== 'inverted') {
    throw new Error(
      `The 'feat' generator scaffolds vertical-slice feats, but the active preset is '${detected}'.`,
    );
  }
  const preset: VerticalPreset = detected;

  const domain = names(options.domain).fileName;
  const sliceRoot = options.app
    ? `apps/${options.app}/src/app/domains/${domain}`
    : `libs/domains/${domain}/src`;

  if (!tree.exists(sliceRoot)) {
    throw new Error(
      `Domain "${domain}" not found at ${sliceRoot} — generate it first (nx g domain ${domain}${options.app ? ` --app ${options.app}` : ''}).`,
    );
  }

  writeFeat(tree, sliceRoot, options.name, preset);
  await formatFiles(tree);
}
