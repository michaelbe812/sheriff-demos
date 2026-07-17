import { formatFiles, names, Tree } from '@nx/devkit';
import { writeFeat } from '../scaffold';

export interface FeatGeneratorSchema {
  name: string;
  domain: string;
  /** App name for an app-internal domain. Omit if the domain is a lib. */
  app?: string;
}

export default async function featGenerator(
  tree: Tree,
  options: FeatGeneratorSchema,
): Promise<void> {
  const domain = names(options.domain).fileName;
  const sliceRoot = options.app
    ? `apps/${options.app}/src/app/domains/${domain}`
    : `libs/domains/${domain}/src`;

  if (!tree.exists(sliceRoot)) {
    throw new Error(
      `Domain "${domain}" not found at ${sliceRoot} — generate it first (nx g domain ${domain}${options.app ? ` --app ${options.app}` : ''}).`,
    );
  }

  writeFeat(tree, sliceRoot, options.name);
  await formatFiles(tree);
}
