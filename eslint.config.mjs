import nx from "@nx/eslint-plugin";
import { createProjectGraphAsync, readCachedProjectGraph } from "@nx/devkit";
import angular from "angular-eslint";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * REDUCED blueprint as pure Nx module boundaries — see docs/nx-umsetzung.md.
 * One lib per slice x layer, tags:
 *   scope:<slice>   booking, checkin, layout, ... | shared
 *   type:<layer>    types, utils, data-access, state, ui, feature | app
 *                   | testing (test-only libs: MSW handlers, fixtures)
 *   feat:<feat>     lib belongs to feat-<feat>/ ; feat:none = outside any feat
 *   entry           the slice root lib (shell: routes/providers) — the only marker
 *
 * No ports: a slice never imports another slice (only itself + shared), a feat
 * never imports a sibling feat. The app shell composes slices via their entry.
 * data-access = HTTP (the only layer with @angular/common/http, generated client api/core, too);
 * state = signal stores + domain events on top of it (no api/events layers).
 *
 * Nx combines ALL constraints matching the source's tags with AND; inside one
 * constraint the target needs ANY of the listed tags — the same semantics as
 * sheriff's depRules.
 */

/**
 * Tags of all projects (every lib's project.json) from the project graph — the Nx rule needs the
 * graph anyway (built on demand below).
 */
const projectGraph = await ensureProjectGraph();
const projectNodes = Object.values(projectGraph?.nodes ?? {});
const allProjectTags = () => projectNodes.flatMap((node) => node.data.tags ?? []);

const tagsWithPrefix = (tags, prefix, ...excluded) =>
    [...new Set(tags)].filter((tag) => tag.startsWith(prefix) && !excluded.includes(tag)).sort();

/** Layers that ship to production — everything except `type:testing`. */
const productionLayers = ["type:types", "type:utils", "type:data-access", "type:state", "type:ui", "type:feature"];

/** Layer matrix (type axis): X may only depend on the listed layers. */
const layerConstraints = [
    // types build on other types only (own slice or shared — the scope constraints still apply), no npm at all
    { sourceTag: "type:types", onlyDependOnLibsWithTags: ["type:types"], bannedExternalImports: ["*"] },
    { sourceTag: "type:utils", onlyDependOnLibsWithTags: ["type:types", "type:utils"] },
    // HTTP wrappers over ApiHttp / the generated clients (generated client api/core are data-access, too)
    { sourceTag: "type:data-access", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:data-access"] },
    // signal stores + domain events, load through data-access
    { sourceTag: "type:state", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:data-access", "type:state"] },
    // dumb components: no data-access, no state — plain values out via outputs, the container makes the event
    { sourceTag: "type:ui", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:ui"] },
    // every production layer — no `type:*` glob, it would match type:testing
    { sourceTag: "type:feature", onlyDependOnLibsWithTags: productionLayers },
    // app shell (main.ts + app/): only slice entries and shared ...
    { sourceTag: "type:app", onlyDependOnLibsWithTags: ["entry", "scope:shared"] },
    // ... and of those only production libs (scope:shared alone would allow shared/testing)
    { sourceTag: "type:app", onlyDependOnLibsWithTags: productionLayers },
    // test-only libs: handlers + fixtures build on types and other testing libs, nothing else
    { sourceTag: "type:testing", onlyDependOnLibsWithTags: ["type:types", "type:testing", "scope:shared"] },
];

/** Test tooling never ships: banned in production code, allowed in type:testing and specs. */
const testOnlyPackages = [
    "msw", "msw/*", "vitest", "vitest/*", "@vitest/*", "@testing-library/*", "playwright", "playwright/*",
    // generated testing libs of the OpenAPI clients: typed MSW + faker factories
    "openapi-msw", "@faker-js/*",
];
const noTestPackagesInProduction = [...productionLayers, "type:app"].map((sourceTag) => ({
    sourceTag,
    bannedExternalImports: testOnlyPackages,
}));

/** Nx-only extra: HTTP is the data-access layer's job — every other production layer is banned from it. */
const httpOnlyInDataAccess = ["type:utils", "type:state", "type:ui", "type:feature"].map((sourceTag) => ({
    sourceTag,
    bannedExternalImports: ["@angular/common/http"],
}));

/**
 * sheriff `sameTag` has no Nx equivalent (no back-reference from source to
 * target tag) => one constraint per scope / feat, generated from the tags
 * that actually exist. A new slice/feat is covered as soon as its first lib's
 * project.json carries the tag (the generators derive it from the path).
 */
function sameTagConstraints(tags) {
    const slices = tagsWithPrefix(tags, "scope:", "scope:shared");
    const feats = tagsWithPrefix(tags, "feat:", "feat:none");
    return [
        // shared area only knows itself
        { sourceTag: "scope:shared", onlyDependOnLibsWithTags: ["scope:shared"] },
        // own slice + shared — never a foreign slice (no port)
        ...slices.map((scope) => ({ sourceTag: scope, onlyDependOnLibsWithTags: [scope, "scope:shared"] })),
        // own feat + everything outside feats — never a sibling feat (no feat-port)
        ...feats.map((feat) => ({ sourceTag: feat, onlyDependOnLibsWithTags: [feat, "feat:none"] })),
    ];
}

/**
 * Nx resolves `@blueprint/<lib>/<deep/path>` to the lib and checks only the
 * tags — the deep import itself passes. Public API = index.ts only, so every
 * path below a lib alias is banned. Generated from the exact lib entries of
 * tsconfig.base.json `paths` (one per lib, target below libs/; the tooling
 * entries keep their subpath exports).
 */
function deepImportPatterns() {
    const { paths } = JSON.parse(readFileSync(join(import.meta.dirname, "tsconfig.base.json"), "utf-8")).compilerOptions;
    return Object.entries(paths)
        .filter(([, targets]) => targets.some((target) => target.startsWith("./libs/")))
        .map(([alias]) => alias)
        .sort()
        .map((alias) => ({
            group: [`${alias}/**`],
            message: `Deep import into ${alias} — only its public API (index.ts) is importable.`,
        }));
}

/**
 * Tooling libs (packages/tooling/<lib>, tag tooling:<lib>), imported only via @blueprint/tooling-<lib>:
 *   conventions  path → tags, scope list, Tree helpers — the base, knows no other tooling lib
 *   openapi      clients (project config, facade, generator) — builds on the conventions only
 *   workspace    generators — conventions, openapi (move/remove keep openapi-clients.json in step)
 *   ng-lib       test executor (Vitest UI flag) around an Nx internal — standalone, knows no conventions/openapi
 *   verify       proofs, read the project graph — standalone
 *   eslint-rules naming rules (blueprint/*), loaded by this config — conventions only
 */
const toolingConstraints = [
    { sourceTag: "tooling:conventions", onlyDependOnLibsWithTags: [] },
    { sourceTag: "tooling:openapi", onlyDependOnLibsWithTags: ["tooling:conventions"] },
    { sourceTag: "tooling:workspace", onlyDependOnLibsWithTags: ["tooling:conventions", "tooling:openapi"] },
    { sourceTag: "tooling:ng-lib", onlyDependOnLibsWithTags: [] },
    { sourceTag: "tooling:verify", onlyDependOnLibsWithTags: [] },
    { sourceTag: "tooling:eslint-rules", onlyDependOnLibsWithTags: ["tooling:conventions"] },
];

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
    ...httpOnlyInDataAccess,
    ...noTestPackagesInProduction,
    ...sameTagConstraints(allProjectTags()),
    // tooling packages (packages/*) are outside the app architecture
    { sourceTag: "type:tooling", onlyDependOnLibsWithTags: ["type:tooling"] },
    ...toolingConstraints,
];

/**
 * Specs (+ test setup files): the same architecture, plus `type:testing` of the
 * own slice and shared (the scope constraints stay: no foreign slice's testing
 * lib — there is no cross-slice code to test against). Test packages are allowed.
 * Unchanged: every `scope:*` (closed slices), `type:types` (testing libs build on
 * types: a types spec importing them would be a cycle), `type:tooling` + `tooling:*`,
 * feat isolation.
 */
const keepsItsTargetsInSpecs = ["type:types", "type:testing", "type:tooling"];
export const specDepConstraints = blueprintDepConstraints
    .filter((constraint) => !noTestPackagesInProduction.includes(constraint))
    .map((constraint) =>
        constraint.onlyDependOnLibsWithTags &&
        !keepsItsTargetsInSpecs.includes(constraint.sourceTag) &&
        !constraint.sourceTag.startsWith("scope:") &&
        !constraint.sourceTag.startsWith("feat:") &&
        !constraint.sourceTag.startsWith("tooling:")
            ? { ...constraint, onlyDependOnLibsWithTags: [...constraint.onlyDependOnLibsWithTags, "type:testing"] }
            : constraint,
    );

export const specFiles = ["**/*.spec.ts", "**/*.test.ts", "**/test-setup.ts"];

/**
 * Naming scheme (docs/nx-umsetzung.md → Namensschema): local rules in packages/tooling/eslint-rules,
 * loaded from source (swc, no build) by Nx's loadWorkspaceRules. Layer, scope and feat come from
 * @blueprint/tooling-conventions — the same path parser the generators derive the tags with.
 * A load error surfaces as "Could not find 'blueprint/…'" — never as silently missing rules.
 */
const eslintRulesDir = join(import.meta.dirname, "packages/tooling/eslint-rules");
const blueprint = {
    meta: { name: "@blueprint/tooling-eslint-rules" },
    rules: await nx.loadWorkspaceRules(join(eslintRulesDir, "src"), join(eslintRulesDir, "tsconfig.json")),
};
/** Component/directive selector prefix = `prefix` in apps/client/project.json and the generator templates. */
export const selectorPrefix = "app";
/** Generated OpenAPI code keeps the names of its spec. */
const generatedCode = ["libs/**/src/generated/**"];

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
        ignores: [
            "**/dist",
            "**/out-tsc"
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
        // generated OpenAPI client code: every file starts with `/* eslint-disable */
        // /* eslint-enable @nx/enforce-module-boundaries, no-restricted-imports */` — only the
        // boundary rules run. The disable directive is intentionally broad.
        files: ["libs/**/src/generated/**"],
        linterOptions: { reportUnusedDisableDirectives: "off" }
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
        files: ["libs/**/*.ts"],
        ignores: generatedCode,
        plugins: { blueprint },
        rules: {
            "blueprint/lib-file-naming": "error",
            "blueprint/layer-symbol-naming": ["error", { selectorPrefix }],
            "blueprint/no-internal-export": "error",
            // general casing; the blueprint rules above check the names themselves
            "@typescript-eslint/naming-convention": [
                "error",
                { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
                { selector: "import", format: null },
                { selector: "typeLike", format: ["PascalCase"] },
                { selector: "enumMember", format: ["PascalCase"] },
                { selector: "variable", modifiers: ["const"], format: ["camelCase", "UPPER_CASE"] },
                { selector: "objectLiteralProperty", format: null }
            ]
        }
    },
    {
        // DTOs mirror the backend payload (`booking_id`)
        files: ["libs/**/*.dto.ts"],
        rules: {
            "@typescript-eslint/naming-convention": [
                "error",
                { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
                { selector: "import", format: null },
                { selector: "typeLike", format: ["PascalCase"] },
                { selector: "typeProperty", format: null }
            ]
        }
    },
    {
        // selector prefix + style: @angular-eslint (libs + app); selector ↔ file name: blueprint/layer-symbol-naming
        files: ["libs/**/*.ts", "apps/**/*.ts"],
        ignores: generatedCode,
        plugins: { "@angular-eslint": angular.tsPlugin },
        rules: {
            "@angular-eslint/component-selector": ["error", { type: "element", prefix: selectorPrefix, style: "kebab-case" }],
            "@angular-eslint/directive-selector": ["error", { type: "attribute", prefix: selectorPrefix, style: "camelCase" }]
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
