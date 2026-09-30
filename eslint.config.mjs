import nx from "@nx/eslint-plugin";
import { createProjectGraphAsync, readCachedProjectGraph } from "@nx/devkit";

/**
 * Blueprint architecture as pure Nx module boundaries — see
 * docs/nx-umsetzung.md. One lib per slice x layer, tags:
 *   scope:<slice>   booking, checkin, auth, layout, ... | shared
 *   type:<layer>    types, utils, events, api, data, ui, feature | app
 *                   | testing (test-only libs: MSW handlers, fixtures)
 *   feat:<feat>     lib belongs to feat-<feat>/ ; feat:none = outside any feat
 *   port            the slice's public api lib (foreign slices may import it)
 *   feat-port       a feat's api lib (sibling feats may import it)
 *   entry           the slice root lib (shell: routes/providers)
 *
 * Nx combines ALL constraints matching the source's tags with AND; inside one
 * constraint the target needs ANY of the listed tags — the same semantics as
 * sheriff's depRules, minus the need for transparent marker rules.
 */

/**
 * Lib projects (and their tags) come from the local plugin
 * packages/tooling/src/plugin/blueprint-libs.ts — there is no project.json to read, so
 * the project graph is the single source of truth. Built on demand below.
 */
const projectGraph = await ensureProjectGraph();
const projectNodes = Object.values(projectGraph?.nodes ?? {});
const allProjectTags = () => projectNodes.flatMap((node) => node.data.tags ?? []);

const tagsWithPrefix = (tags, prefix, ...excluded) =>
    [...new Set(tags)].filter((tag) => tag.startsWith(prefix) && !excluded.includes(tag)).sort();

/** Layers that ship to production — everything except `type:testing`. */
const productionLayers = ["type:types", "type:utils", "type:events", "type:api", "type:data", "type:ui", "type:feature"];

/** Layer matrix (type axis): X may only depend on the listed layers. */
const layerConstraints = [
    // types build on other types only (own slice or shared — the scope constraints still apply), no npm at all
    { sourceTag: "type:types", onlyDependOnLibsWithTags: ["type:types"], bannedExternalImports: ["*"] },
    { sourceTag: "type:utils", onlyDependOnLibsWithTags: ["type:types", "type:utils"] },
    { sourceTag: "type:events", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:events"] },
    { sourceTag: "type:api", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:api"] },
    { sourceTag: "type:data", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:api", "type:data", "type:events"] },
    { sourceTag: "type:ui", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:ui", "type:events"] },
    // every production layer — no `type:*` glob, it would match type:testing
    { sourceTag: "type:feature", onlyDependOnLibsWithTags: productionLayers },
    // app shell (main.ts + app/): only slice entries, ports and shared ...
    { sourceTag: "type:app", onlyDependOnLibsWithTags: ["entry", "port", "scope:shared"] },
    // ... and of those only production libs (scope:shared alone would allow shared/testing)
    { sourceTag: "type:app", onlyDependOnLibsWithTags: productionLayers },
    // test-only libs: handlers + fixtures build on types and other testing libs, nothing else
    { sourceTag: "type:testing", onlyDependOnLibsWithTags: ["type:types", "type:testing", "scope:shared"] },
];

/** Test tooling never ships: banned in production code, allowed in type:testing and specs. */
const testOnlyPackages = ["msw", "msw/*", "vitest", "vitest/*", "@vitest/*", "@testing-library/*", "playwright", "playwright/*"];
const noTestPackagesInProduction = [...productionLayers, "type:app"].map((sourceTag) => ({
    sourceTag,
    bannedExternalImports: testOnlyPackages,
}));

/** Nx-only extra: HTTP is the api layer's job (api = http in the blueprint). */
const httpOnlyInApi = ["type:utils", "type:events", "type:data", "type:ui", "type:feature"].map((sourceTag) => ({
    sourceTag,
    bannedExternalImports: ["@angular/common/http"],
}));

/**
 * sheriff `sameTag` has no Nx equivalent (no back-reference from source to
 * target tag) => one constraint per scope / feat, generated from the tags
 * that actually exist. A new slice/feat is covered as soon as its first lib
 * folder (with src/index.ts) exists — the plugin derives the tag.
 */
function sameTagConstraints(tags) {
    const slices = tagsWithPrefix(tags, "scope:", "scope:shared");
    const feats = tagsWithPrefix(tags, "feat:", "feat:none");
    return [
        // shared area only knows itself
        { sourceTag: "scope:shared", onlyDependOnLibsWithTags: ["scope:shared"] },
        // own slice freely, foreign slices (domains + shared features) only via port
        ...slices.map((scope) => ({ sourceTag: scope, onlyDependOnLibsWithTags: [scope, "port", "scope:shared"] })),
        // own feat, everything outside feats, sibling feats only via feat-port
        ...feats.map((feat) => ({ sourceTag: feat, onlyDependOnLibsWithTags: [feat, "feat:none", "feat-port"] })),
    ];
}

/**
 * Nx resolves `@blueprint/<lib>/<deep/path>` to the lib and checks only the
 * tags — the deep import itself passes. Public API = index.ts only, so every
 * path below a lib alias is banned. tsconfig.base.json has a single wildcard
 * `@blueprint/*` -> `libs/*\/src/index.ts`, so the aliases are derived from
 * the lib roots (alias = `@blueprint/` + path below libs/).
 */
function deepImportPatterns() {
    return projectNodes
        .filter((node) => node.data.root.startsWith("libs/"))
        .map((node) => `@blueprint/${node.data.root.slice("libs/".length)}`)
        .sort()
        .map((alias) => ({
            group: [`${alias}/**`],
            message: `Deep import into ${alias} — only its public API (index.ts) is importable.`,
        }));
}

/**
 * @nx/enforce-module-boundaries reads the CACHED project graph and silently
 * skips (warning only) when there is none — e.g. plain `eslint` or the IDE
 * after a fresh clone / `nx reset`. `nx lint` builds it itself; for every
 * other entry point build it once here, so the boundaries always apply.
 */
async function ensureProjectGraph() {
    try {
        return readCachedProjectGraph();
    } catch {
        return createProjectGraphAsync({ exitOnError: false }).catch(() => undefined);
    }
}

export const blueprintDepConstraints = [
    ...layerConstraints,
    ...httpOnlyInApi,
    ...noTestPackagesInProduction,
    ...sameTagConstraints(allProjectTags()),
    // tooling packages (packages/*) are outside the app architecture
    { sourceTag: "type:tooling", onlyDependOnLibsWithTags: ["type:tooling"] },
];

/**
 * Specs (+ test setup files): the same architecture, plus `type:testing` —
 * also a foreign domain's testing lib (a feature spec may need the booking
 * handlers behind the booking port). Test packages are allowed.
 * Unchanged: `scope:shared` (shared never knows a domain, so only
 * shared/testing), `type:types` (testing libs build on types: a types spec
 * importing them would be a cycle), `type:tooling`, feat isolation.
 */
const keepsItsTargetsInSpecs = ["type:types", "type:testing", "scope:shared", "type:tooling"];
export const specDepConstraints = blueprintDepConstraints
    .filter((constraint) => !noTestPackagesInProduction.includes(constraint))
    .map((constraint) =>
        constraint.onlyDependOnLibsWithTags && !keepsItsTargetsInSpecs.includes(constraint.sourceTag) && !constraint.sourceTag.startsWith("feat:")
            ? { ...constraint, onlyDependOnLibsWithTags: [...constraint.onlyDependOnLibsWithTags, "type:testing"] }
            : constraint,
    );

export const specFiles = ["**/*.spec.ts", "**/*.test.ts", "**/test-setup.ts"];

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
        ignores: [
            "**/dist",
            "**/out-tsc",
            // generated by `msw init`
            "**/mockServiceWorker.js"
        ]
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    enforceBuildableLibDependency: true,
                    allow: ["^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"],
                    depConstraints: blueprintDepConstraints
                }
            ],
            "no-restricted-imports": ["error", { patterns: deepImportPatterns() }]
        }
    },
    {
        files: specFiles,
        rules: {
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    // buildable libs import the non-buildable testing libs — in specs only,
                    // which the lib build (tsconfig.lib.json) excludes
                    enforceBuildableLibDependency: false,
                    allow: ["^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"],
                    depConstraints: specDepConstraints
                }
            ]
        }
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs"
        ],
        // Override or add rules here
        rules: {}
    }
];
