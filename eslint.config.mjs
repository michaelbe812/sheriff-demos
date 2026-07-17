import nx from "@nx/eslint-plugin";
import sheriff from "@softarc/eslint-plugin-sheriff";
import { nxModuleBoundariesOptions } from "@berger-engineering/sheriff-blueprint";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    sheriff.configs.all,
    {
        // tooling packages are not part of the app architecture
        files: ["packages/**"],
        rules: {
            "@softarc/sheriff/dependency-rule": "off",
            "@softarc/sheriff/encapsulation": "off"
        }
    },
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
                nxModuleBoundariesOptions("@blueprint")
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
