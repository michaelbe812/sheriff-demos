import nx from "@nx/eslint-plugin";
import { createProjectGraphAsync, readCachedProjectGraph } from "@nx/devkit";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Blueprint architecture as pure Nx module boundaries — see
 * docs/nx-umsetzung.md. One lib per slice x layer, tags:
 *   scope:<slice>   booking, checkin, auth, layout, ... | shared
 *   type:<layer>    types, utils, events, api, data, ui, feature | app
 *   feat:<feat>     lib belongs to feat-<feat>/ ; feat:none = outside any feat
 *   port            the slice's public api lib (foreign slices may import it)
 *   feat-port       a feat's api lib (sibling feats may import it)
 *   entry           the slice root lib (shell: routes/providers)
 *
 * Nx combines ALL constraints matching the source's tags with AND; inside one
 * constraint the target needs ANY of the listed tags — the same semantics as
 * sheriff's depRules, minus the need for transparent marker rules.
 */

const workspaceRoot = import.meta.dirname;
const projectDirs = ["apps", "libs", "packages"];

/** Tags of all projects, read from project.json (no project graph needed). */
function readAllProjectTags() {
    return projectDirs.flatMap((dir) =>
        readdirSync(join(workspaceRoot, dir), { recursive: true })
            .filter((file) => file.endsWith("project.json") && !file.includes("node_modules"))
            .flatMap((file) => JSON.parse(readFileSync(join(workspaceRoot, dir, file), "utf-8")).tags ?? []),
    );
}

const tagsWithPrefix = (tags, prefix, ...excluded) =>
    [...new Set(tags)].filter((tag) => tag.startsWith(prefix) && !excluded.includes(tag)).sort();

/** Layer matrix (type axis): X may only depend on the listed layers. */
const layerConstraints = [
    { sourceTag: "type:types", onlyDependOnLibsWithTags: [], bannedExternalImports: ["*"] },
    { sourceTag: "type:utils", onlyDependOnLibsWithTags: ["type:types", "type:utils"] },
    { sourceTag: "type:events", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:events"] },
    { sourceTag: "type:api", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:api"] },
    { sourceTag: "type:data", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:api", "type:data", "type:events"] },
    { sourceTag: "type:ui", onlyDependOnLibsWithTags: ["type:types", "type:utils", "type:ui", "type:events"] },
    { sourceTag: "type:feature", onlyDependOnLibsWithTags: ["type:*"] },
    // app shell (main.ts + app/): only slice entries, ports and shared
    { sourceTag: "type:app", onlyDependOnLibsWithTags: ["entry", "port", "scope:shared"] },
];

/** Nx-only extra: HTTP is the api layer's job (api = http in the blueprint). */
const httpOnlyInApi = ["type:utils", "type:events", "type:data", "type:ui", "type:feature"].map((sourceTag) => ({
    sourceTag,
    bannedExternalImports: ["@angular/common/http"],
}));

/**
 * sheriff `sameTag` has no Nx equivalent (no back-reference from source to
 * target tag) => one constraint per scope / feat, generated from the tags
 * that actually exist. A new slice/feat is covered as soon as its
 * project.json carries the tag.
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
 * path below a lib alias is banned (TS would fail too, but later and vaguer).
 */
function deepImportPatterns() {
    const { paths } = JSON.parse(readFileSync(join(workspaceRoot, "tsconfig.base.json"), "utf-8")).compilerOptions;
    return Object.keys(paths).map((alias) => ({
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
        readCachedProjectGraph();
    } catch {
        await createProjectGraphAsync({ exitOnError: false });
    }
}

await ensureProjectGraph();

export const blueprintDepConstraints = [
    ...layerConstraints,
    ...httpOnlyInApi,
    ...sameTagConstraints(readAllProjectTags()),
    // tooling packages (packages/*) are outside the app architecture
    { sourceTag: "type:tooling", onlyDependOnLibsWithTags: ["type:tooling"] },
];

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
