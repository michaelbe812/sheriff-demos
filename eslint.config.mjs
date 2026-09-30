import { createProjectGraphAsync } from "@nx/devkit";
import nx from "@nx/eslint-plugin";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Architecture rules — Vertical Slice, inverted — expressed with plain Nx:
 * one lib per slice x layer, tags on every lib, `@nx/enforce-module-boundaries`.
 * Mapping to the former Sheriff rules: docs/nx-umsetzung.md.
 * Negative/positive tests: tools/verify-boundaries.mjs.
 *
 * Tag schema (every lib carries exactly one scope:* and one type:* tag):
 *   scope:<slice>              slice-shared lib (types, utils, api, data, ...)
 *   scope:<slice>/feat-<name>  lib of ONE feat (feature, feat-local api/data/ui)
 *   scope:shared               dumb shared area
 *   type:<layer>               types|utils|events|api|infra|data|ui|feature|shell
 *   port                       slice api — the only lib foreign scopes may use
 *   feat-port                  feat api — the only feat lib sibling feats may use
 *   type:app                   apps (composition root of the whole app)
 *   type:tooling               packages/* (outside the app architecture)
 *
 * All constraints whose source tags match a project apply with AND semantics:
 * the type axis and the scope axis must BOTH allow an import.
 */

const workspaceRoot = import.meta.dirname;

// `@nx/enforce-module-boundaries` only reads the CACHED project graph. Without
// one (fresh clone, plain `eslint`, IDE) it skips silently with a warning;
// with a stale one it does not know new libs and skips their imports. Build /
// refresh the graph once per ESLint process, before the rule runs. Throws
// (config load fails) instead of skipping when the graph cannot be built.
await createProjectGraphAsync({ exitOnError: false });

// ---------------------------------------------------------------------------
// type axis — the layer matrix (X may depend on Y)
// ---------------------------------------------------------------------------
const layerMatrix = {
    // shared vocabulary may build on other types (own slice or shared)
    "type:types": ["type:types"],
    "type:utils": ["type:types", "type:utils"],
    "type:events": ["type:types", "type:utils", "type:events"],
    // the contract: NOT infra — that is the inversion
    "type:api": ["type:types", "type:utils", "type:api"],
    "type:infra": ["type:types", "type:utils", "type:api", "type:infra"],
    // stores bind to the port, never to infra
    "type:data": ["type:types", "type:utils", "type:api", "type:data", "type:events"],
    // dumb components: NOT api, NOT data
    "type:ui": ["type:types", "type:utils", "type:ui", "type:events"],
    // smart containers (feat libs): everything except infra and shells
    "type:feature": ["type:types", "type:utils", "type:events", "type:api", "type:data", "type:ui"],
    // slice root = composition root of the slice: the ONLY lib that may wire infra
    "type:shell": [
        "type:types", "type:utils", "type:events", "type:api",
        "type:infra", "type:data", "type:ui", "type:feature"
    ]
};

const typeAxis = Object.entries(layerMatrix).map(([sourceTag, allowed]) => ({
    sourceTag,
    onlyDependOnLibsWithTags: allowed
}));

// ---------------------------------------------------------------------------
// scope axis — derived from the tags in libs/**/project.json, never listed by
// hand: a new slice or feat is covered as soon as its project.json exists.
// ---------------------------------------------------------------------------
function findProjectJsonFiles(dir) {
    const own = existsSync(join(dir, "project.json")) ? [join(dir, "project.json")] : [];
    const nested = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "src" && entry.name !== "node_modules")
        .flatMap((entry) => findProjectJsonFiles(join(dir, entry.name)));
    return [...own, ...nested];
}

/** Fails loudly on a lib without exactly one scope and one known type tag (Sheriff's `noTag`). */
function readLibTags() {
    return findProjectJsonFiles(join(workspaceRoot, "libs")).map((file) => {
        const { name, tags = [] } = JSON.parse(readFileSync(file, "utf-8"));
        const scopes = tags.filter((tag) => tag.startsWith("scope:"));
        const types = tags.filter((tag) => tag in layerMatrix);
        if (scopes.length !== 1 || types.length !== 1) {
            throw new Error(`lib "${name}" needs exactly one scope:* and one known type:* tag, has [${tags}]`);
        }
        return tags;
    });
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Nx tag regex (`/.../`): the slice itself or any of its feats. */
const sliceOrItsFeats = (slice) => `/^${escapeRegExp(slice)}(\\/.*)?$/`;

const allScopes = [...new Set(readLibTags().flat().filter((tag) => tag.startsWith("scope:")))];
const sliceScopes = allScopes.filter((scope) => scope !== "scope:shared" && !scope.includes("/"));
const featScopes = allScopes.filter((scope) => scope.includes("/"));

/**
 * Nx has no `sameTag`: one constraint per slice. Own slice (incl. its feats)
 * freely, foreign slices only via `port`, plus the shared area.
 */
const sliceIsolation = (slice) => ({
    sourceTag: sliceOrItsFeats(slice),
    onlyDependOnLibsWithTags: [sliceOrItsFeats(slice), "port", "scope:shared"]
});

/**
 * Feats are private: slice-shared libs never reach into them — only the shell
 * lazy-loads them. `(?!shell$)` is the negation Nx lacks (regex lookahead on
 * the type tag), so the shell is exempt.
 */
const featPrivacy = (slice) => ({
    allSourceTags: [slice, "/^type:(?!shell$)/"],
    onlyDependOnLibsWithTags: [slice, "port", "scope:shared"]
});

/**
 * A feat sees its own libs, the slice-shared libs, sibling feats ONLY via
 * `feat-port` (sliceIsolation keeps foreign feat-ports out), ports, shared.
 */
const featIsolation = (feat) => ({
    sourceTag: feat,
    onlyDependOnLibsWithTags: [feat, feat.split("/")[0], "feat-port", "port", "scope:shared"]
});

const scopeAxis = [
    ...sliceScopes.map(sliceIsolation),
    ...sliceScopes.map(featPrivacy),
    ...featScopes.map(featIsolation),
    // shared is dumb: it never reaches into a slice
    { sourceTag: "scope:shared", onlyDependOnLibsWithTags: ["scope:shared"] },
    // the app composes slices via their shell, binds to ports, uses shared
    { sourceTag: "type:app", onlyDependOnLibsWithTags: ["type:shell", "port", "scope:shared"] },
    // tooling packages (packages/*) are outside the app architecture
    { sourceTag: "type:tooling", onlyDependOnLibsWithTags: ["type:tooling"] }
];

// ---------------------------------------------------------------------------
// npm axis — what Sheriff cannot express at all
// ---------------------------------------------------------------------------
const externalAxis = [
    // HTTP is an infra concern; the app may still call provideHttpClient()
    { sourceTag: "/^type:(?!infra$|app$)/", bannedExternalImports: ["@angular/common/http*"] }
];

export const depConstraints = [...typeAxis, ...scopeAxis, ...externalAxis];

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
                    // no catch-all `sourceTag: '*'`: a project without matching
                    // tags cannot depend on any lib (Sheriff's noTag rule)
                    depConstraints
                }
            ],
            // Nx only checks imports it can map to a project: a deep import
            // (`@blueprint/x/data/src/file`) matches no tsconfig path, so the
            // boundary rule skips it and only tsc fails later. Make it an
            // architecture error instead — the lib's index.ts is its public API.
            "no-restricted-imports": [
                "error",
                {
                    patterns: [{
                        group: ["@blueprint/**/src", "@blueprint/**/src/**"],
                        message: "Deep import: only the lib's public API (index.ts) may be imported."
                    }]
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
