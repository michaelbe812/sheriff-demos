/**
 * ArchUnitTS spike: the blueprint's Nx module boundaries (eslint.config.mjs) as architecture tests.
 *
 *   pnpm nx run archunit:arch     (or: vitest run --config tools/archunit/vitest.config.mts)
 *
 * What ArchUnitTS sees: a file graph built by the TypeScript compiler API from tsconfig.archunit.json
 * (aliases from tsconfig.base.json `paths` are resolved to the target file, e.g. libs/booking/data/src/index.ts).
 * Only `import … from` declarations become edges — NOT `export … from`, NOT dynamic `import()`, and
 * imports into node_modules are dropped. External packages and deep imports are therefore checked on the
 * file content (custom `adhereTo` rules), not on the graph.
 */
import { chdir } from 'node:process';
import {
  extractGraph,
  projectCycles,
  projectEdges,
  projectFiles,
  sliceByRegex,
  type FileInfo,
} from 'archunit';
import {
  type Constraint,
  type Lib,
  CLIENT_PARTS,
  FILE_KINDS,
  LAYERS,
  SPEC_FILE_NAMES,
  TSCONFIG,
  WORKSPACE_ROOT,
  blueprintDepConstraints,
  discoverLibs,
  libAliases,
  publicEntries,
  specDepConstraints,
} from './blueprint';

// file labels + FileInfo.content are relative to the cwd (archunit issue #109) — run from the workspace root
chdir(WORKSPACE_ROOT);

const libs = discoverLibs();
const SPEC_NAME = /(\.spec|\.test)\.ts$|^test-setup\.ts$/;
const productionOnly = { except: { withName: SPEC_FILE_NAMES } };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Folder matcher for a set of lib roots (archunit matches `inFolder` against the path without file name). */
const inRoots = (roots: string[]) => new RegExp(`^(?:${roots.map(escape).join('|')})(?:/|$)`);
const hasTag = (lib: Lib, tag: string) => lib.tags?.includes(tag) ?? false;

/**
 * Nx `onlyDependOnLibsWithTags` → ArchUnitTS deny rule: ArchUnitTS has no allow-list ("only depend on")
 * that works per source — `should().dependOnFiles()` flags every edge of the whole project outside the
 * pattern. So the complement is computed: every lib (or untagged lib) without one of the allowed tags.
 * The source libs themselves are left out (intra-lib imports, archunit's self-edges).
 */
function split(constraint: Constraint) {
  const sources = libs.filter((lib) => hasTag(lib, constraint.sourceTag));
  const allowed = constraint.onlyDependOnLibsWithTags ?? [];
  const forbidden = libs.filter(
    (lib) => !sources.includes(lib) && !allowed.some((tag) => hasTag(lib, tag)),
  );
  return { sources: sources.map((lib) => lib.root), forbidden: forbidden.map((lib) => lib.root) };
}

const title = (constraint: Constraint) =>
  `${constraint.sourceTag} → nur [${(constraint.onlyDependOnLibsWithTags ?? []).join(', ')}]`;

describe('depConstraints (Produktionscode)', () => {
  const constraints = blueprintDepConstraints(libs).filter((c) => c.onlyDependOnLibsWithTags);
  it.each(constraints.map((c) => [title(c), c] as const))('%s', async (_, constraint) => {
    const { sources, forbidden } = split(constraint);
    if (sources.length === 0 || forbidden.length === 0) return;
    const rule = projectFiles(TSCONFIG)
      .inFolder(inRoots(sources), productionOnly)
      .shouldNot()
      .dependOnFiles()
      .inFolder(inRoots(forbidden));
    // libs without .ts files (tooling ng-lib: JS only) would otherwise fail as "empty test"
    await expect(rule).toPassAsync({ allowEmptyTests: true });
  });
});

describe('depConstraints (Specs: + type:testing)', () => {
  const constraints = specDepConstraints(libs).filter((c) => c.onlyDependOnLibsWithTags);
  it.each(constraints.map((c) => [title(c), c] as const))('%s', async (_, constraint) => {
    const { sources, forbidden } = split(constraint);
    if (sources.length === 0 || forbidden.length === 0) return;
    const rule = projectFiles(TSCONFIG)
      .inFolder(inRoots(sources))
      .withName(SPEC_NAME)
      .shouldNot()
      .dependOnFiles()
      .inFolder(inRoots(forbidden));
    await expect(rule).toPassAsync({ allowEmptyTests: true });
  });
});

// ---------------------------------------------------------------------------------------------
// bannedExternalImports — not in archunit's graph (node_modules targets are dropped) → file content
// ---------------------------------------------------------------------------------------------

/** Module specifiers of a file: import/export … from, side-effect import, dynamic import(). */
export function moduleSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const pattern =
    /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of content.matchAll(pattern)) specifiers.push(match[1] ?? match[2] ?? match[3]);
  return specifiers;
}
const aliases = publicEntries().map(({ alias }) => alias);
const isExternal = (specifier: string) =>
  !specifier.startsWith('.') && !aliases.some((alias) => specifier === alias || specifier.startsWith(`${alias}/`));
/** Nx bannedExternalImports globs as used here: `*`, `pkg`, `pkg/*`, `@scope/*`. */
const bannedBy = (pattern: string, specifier: string) =>
  pattern === '*' || (pattern.endsWith('/*') ? specifier.startsWith(pattern.slice(0, -1)) : specifier === pattern);
const violatesBan = (banned: string[]) => (file: FileInfo) =>
  !moduleSpecifiers(file.content).some((s) => isExternal(s) && banned.some((pattern) => bannedBy(pattern, s)));

describe('bannedExternalImports', () => {
  const run = async (constraint: Constraint, spec: boolean) => {
    const sources = libs.filter((lib) => hasTag(lib, constraint.sourceTag)).map((lib) => lib.root);
    if (sources.length === 0) return;
    const banned = constraint.bannedExternalImports ?? [];
    const selection = spec
      ? projectFiles(TSCONFIG).inFolder(inRoots(sources)).withName(SPEC_NAME)
      : projectFiles(TSCONFIG).inFolder(inRoots(sources), productionOnly);
    const rule = selection
      .should()
      .adhereTo(violatesBan(banned), `${constraint.sourceTag}: keine Imports von ${banned.join(', ')}`);
    await expect(rule).toPassAsync({ allowEmptyTests: true });
  };
  const banTitle = (c: Constraint) => `${c.sourceTag} ✗ ${c.bannedExternalImports?.join(', ')}`;
  const prod = blueprintDepConstraints(libs).filter((c) => c.bannedExternalImports);
  it.each(prod.map((c) => [banTitle(c), c] as const))('Produktion: %s', (_, c) => run(c, false));
  const spec = specDepConstraints(libs).filter((c) => c.bannedExternalImports);
  it.each(spec.map((c) => [banTitle(c), c] as const))('Specs: %s', (_, c) => run(c, true));
});

// ---------------------------------------------------------------------------------------------
// encapsulation: public API = the tsconfig paths entry (index.ts)
// ---------------------------------------------------------------------------------------------

describe('Kapselung', () => {
  const entries = publicEntries();
  // Nx: "Projects cannot be imported by a relative or absolute path" — a relative import into a foreign
  // lib resolves to a non-entry file of it. One rule per lib (no back-reference "same lib" in archunit).
  it.each(libs.map((lib) => [lib.root] as const))('%s: von außen nur über den Alias (index.ts)', async (root) => {
    const publicFiles = entries.filter(({ file }) => file.startsWith(`${root}/`)).map(({ file }) => file);
    const rule = projectFiles(TSCONFIG)
      .inPath(/^(libs|apps|packages)\//, { except: { inFolder: inRoots([root]) } })
      .shouldNot()
      .dependOnFiles()
      .inFolder(inRoots([root]), { except: { inPath: publicFiles.length ? publicFiles.map((f) => new RegExp(`^${escape(f)}$`)) : [] } });
    await expect(rule).toPassAsync({ allowEmptyTests: true });
  });

  // deep alias imports (`@blueprint/booking/data/src/…`) do NOT resolve (exact paths entries) → archunit
  // drops them silently from the graph; only a content check sees them
  it('keine Deep-Imports unter einen Lib-Alias', async () => {
    const libAliasList = libAliases();
    const rule = projectFiles(TSCONFIG)
      .inPath(/^(libs|apps|packages)\//)
      .should()
      .adhereTo(
        (file) => !moduleSpecifiers(file.content).some((s) => libAliasList.some((alias) => s.startsWith(`${alias}/`))),
        'Deep import: nur die Public API (index.ts) eines Lib-Alias ist importierbar',
      );
    await expect(rule).toPassAsync();
  });
});

// ---------------------------------------------------------------------------------------------
// cycles
// ---------------------------------------------------------------------------------------------

describe('Zyklen', () => {
  it('keine Datei-Zyklen (archunit nativ)', async () => {
    const rule = projectFiles(TSCONFIG).inFolder(/^(libs|apps|packages)\//).should().haveNoCycles();
    await expect(rule).toPassAsync();
  });

  // Nx checks cycles between PROJECTS. archunit has no lib-level cycle rule for plain folders
  // (`projectSlices().definedBy('libs/(**)/')` captures only [\w]+, no kebab-case, no nesting) — but its
  // building blocks are exported: graph → projection onto lib roots → cycle search.
  it('keine Lib-Zyklen (Projektion auf Lib-Ordner)', async () => {
    const graph = await extractGraph(TSCONFIG);
    const libRoot = new RegExp(`^(${libs.map((lib) => escape(lib.root)).join('|')})/`);
    const libEdges = projectEdges(graph, sliceByRegex(libRoot));
    const cycles = projectCycles(libEdges).map((cycle) => cycle.map((edge) => `${edge.sourceLabel} → ${edge.targetLabel}`).join(' | '));
    expect(cycles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// structure + naming (no Nx equivalent — eslint rules / verify scripts in the Nx variant)
// ---------------------------------------------------------------------------------------------

const KEBAB = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const libShape = new RegExp(
  `^libs/(?:${KEBAB}/(?:feat-${KEBAB}/)?(?:${LAYERS.join('|')})|(?:${KEBAB}/)?generated/${KEBAB}/(?:${Object.keys(CLIENT_PARTS).join('|')}))/src(?:/|$)`,
);
/** folder of a layer (shell counts as its own folder name here) */
const layerFolder = (layers: string[]) =>
  new RegExp(`^libs/${KEBAB}/(?:feat-${KEBAB}/)?(?:${layers.join('|')})/src(?:/|$)`);

describe('Struktur + Namen', () => {
  // Nx: untagged lib (noTag) + verify folderError — here: every file below libs/ sits in a known lib shape
  it('jede Datei unter libs/ liegt in einer Lib der Form <scope>/[feat-<feat>/]<layer> | [<domain>/]generated/<client>/<part>', async () => {
    const rule = projectFiles(TSCONFIG).inFolder(/^libs\//).should().beInFolder(libShape);
    await expect(rule).toPassAsync();
  });

  it.each(Object.entries(FILE_KINDS))('*.%s.ts nur in Layer %s', async (kind, layers) => {
    const rule = projectFiles(TSCONFIG)
      .inFolder(/^libs\//, { except: { inFolder: /\/src\/generated(\/|$)/ } })
      .withName(`*.${kind}.ts`)
      .should()
      .beInFolder(layerFolder(layers));
    await expect(rule).toPassAsync({ allowEmptyTests: true });
  });

  it('Dateinamen kebab-case (<name>[.<kind>][.spec].ts)', async () => {
    const rule = projectFiles(TSCONFIG)
      .inFolder(/^libs\//, { except: { inFolder: /\/src\/generated(\/|$)/ } })
      .should()
      .haveName(new RegExp(`^${KEBAB}(?:\\.[a-z]+)?(?:\\.spec)?\\.ts$`));
    await expect(rule).toPassAsync();
  });

  it('*.store.ts exportiert eine Klasse <Name>Store (Inhaltsregel)', async () => {
    const rule = projectFiles(TSCONFIG)
      .inFolder(/^libs\//)
      .withName('*.store.ts')
      .should()
      .adhereTo((file) => /export\s+class\s+[A-Z][A-Za-z0-9]*Store\b/.test(file.content), 'Store-Datei exportiert <Name>Store');
    await expect(rule).toPassAsync();
  });

  // Nx "lazy-loaded" check: a lib loaded via import() in the app must not be imported statically there
  it('App importiert lazy geladene Entries nicht statisch', async () => {
    const appFiles = projectFiles(TSCONFIG).inFolder(/^apps\//);
    const lazy = new Set<string>();
    await appFiles
      .should()
      .adhereTo((file) => {
        for (const match of file.content.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) lazy.add(match[1]);
        return true;
      }, 'collect')
      .check();
    const rule = appFiles
      .should()
      .adhereTo(
        (file) => !moduleSpecifiers(file.content.replace(/import\s*\(\s*['"][^'"]+['"]\s*\)/g, '')).some((s) => lazy.has(s)),
        `lazy geladene Libs (${[...lazy].join(', ')}) nicht statisch importieren`,
      );
    await expect(rule).toPassAsync();
  });
});
