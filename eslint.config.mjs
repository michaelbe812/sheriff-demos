import nx from "@nx/eslint-plugin";
import { readdirSync } from "node:fs";

/**
 * Ports & Adapters (hexagonal), FRAMEWORK-AWARE CORE — enforced with Nx only.
 *
 * One Nx lib per slice x hexagon part. Tags (docs/nx-umsetzung.md):
 *   scope:  scope:<slice> | scope:shared      app:<app> on applications
 *   type:   model | domain | port-in | port-out | adapter-driving |
 *           adapter-driven | providers | shell | ui | util | types
 *   marker: entry (shell/providers) | port (port-in, the only cross-slice door)
 *
 * Semantics (enforce-module-boundaries.js, `for (const constraint of
 * constraints)`): EVERY constraint whose sourceTag matches the source lib is
 * checked and each one can fail the import. Constraints only ever narrow — a
 * `'*'` catch-all cannot widen anything. That is the opposite of Sheriff's
 * OR'ed depRules, so the "no '*' rule" workaround is not needed here.
 */

/** Every folder under libs/ except shared/ is a slice = one hexagon. */
const slices = readdirSync(new URL("./libs", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
    .map((entry) => entry.name);

/**
 * Nx has no `sameTag`: a tag pattern cannot refer back to the source's own
 * scope. So each slice gets its own constraint — generated, so a new slice
 * folder is covered automatically (tools/verify-boundaries.mjs double-checks).
 */
const sliceIsolation = (slice) => ({
    sourceTag: `scope:${slice}`,
    onlyDependOnLibsWithTags: [`scope:${slice}`, "port", "scope:shared"],
});

/** The core may know Angular DI/signals and plain rxjs — nothing that does I/O. */
const coreExternals = ["@angular/core", "@angular/core/rxjs-interop", "rxjs", "rxjs/operators"];

/** I/O entry points no UI adapter may touch — HTTP belongs to driven adapters. */
const ioExternals = ["@angular/common/http", "rxjs/ajax", "rxjs/fetch", "rxjs/webSocket"];

export const moduleBoundaryOptions = {
    enforceBuildableLibDependency: true,
    allow: ["^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"],
    depConstraints: [
        // ---- SCOPE AXIS ----------------------------------------------------
        // app isolation: apps see slices only through `entry` / `port`.
        // app -> app is blocked by Nx itself (noImportsOfApps).
        { sourceTag: "app:*", onlyDependOnLibsWithTags: ["entry", "port", "scope:shared"] },
        ...slices.map(sliceIsolation),
        // shared is dumb: not even transitively may it reach a slice.
        {
            sourceTag: "scope:shared",
            onlyDependOnLibsWithTags: ["scope:shared"],
            notDependOnLibsWithTags: ["/^scope:(?!shared$)/"],
        },

        // ---- TYPE AXIS -----------------------------------------------------
        // the model: entities + ids, the vocabulary domain and ports share.
        // Pure TypeScript — no framework, no other slice part. Splitting it
        // out of domain keeps the lib graph acyclic (domain -> port-out ->
        // model), which buildable libs need (`dependsOn: ^build`).
        {
            sourceTag: "type:model",
            onlyDependOnLibsWithTags: ["type:model", "type:types"],
            allowedExternalImports: [],
        },
        // the core: own ports, shared helpers, types. NEVER an adapter or the
        // wiring — checked transitively, so no detour via another lib either.
        {
            sourceTag: "type:domain",
            onlyDependOnLibsWithTags: ["type:model", "type:domain", "type:port-in", "type:port-out", "type:util", "type:types"],
            notDependOnLibsWithTags: ["/^type:adapter-/", "entry"],
            allowedExternalImports: coreExternals,
        },
        {
            sourceTag: "type:port-in",
            onlyDependOnLibsWithTags: ["type:model", "type:domain", "type:types"],
            allowedExternalImports: coreExternals,
        },
        // out-ports speak the model only — never the domain that injects them
        // (that edge would close the domain <-> port-out cycle).
        {
            sourceTag: "type:port-out",
            onlyDependOnLibsWithTags: ["type:model", "type:types"],
            allowedExternalImports: coreExternals,
        },
        // UI: own store (domain) + ports/in. Never ports/out, never HTTP.
        {
            sourceTag: "type:adapter-driving",
            onlyDependOnLibsWithTags: ["type:model", "type:domain", "type:port-in", "type:ui", "type:util", "type:types"],
            bannedExternalImports: ioExternals,
        },
        {
            sourceTag: "type:adapter-driven",
            onlyDependOnLibsWithTags: ["type:model", "type:domain", "type:port-out", "type:util", "type:types"],
        },
        // composition root + routes: both sides of their own hexagon (the
        // scope axis keeps them inside it).
        { sourceTag: "type:providers", onlyDependOnLibsWithTags: ["type:*"] },
        { sourceTag: "type:shell", onlyDependOnLibsWithTags: ["type:*"] },
        { sourceTag: "type:ui", onlyDependOnLibsWithTags: ["type:ui", "type:util", "type:types"] },
        { sourceTag: "type:util", onlyDependOnLibsWithTags: ["type:util", "type:types"] },
        { sourceTag: "type:types", onlyDependOnLibsWithTags: ["type:types"], allowedExternalImports: [] },

        // ---- COMBINED (allSourceTags) --------------------------------------
        // shared UI is presentational: Angular core/common, no router, no HTTP.
        {
            allSourceTags: ["scope:shared", "type:ui"],
            allowedExternalImports: ["@angular/core", "@angular/common"],
        },
    ],
};

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
            "@nx/enforce-module-boundaries": ["error", moduleBoundaryOptions]
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
