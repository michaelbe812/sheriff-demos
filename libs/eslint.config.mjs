import nx from "@nx/eslint-plugin";
import baseConfig from "../eslint.config.mjs";

/** Shared by all libs — Nx resolves the nearest flat config upwards from each lib root. */
export default [
    ...nx.configs["flat/angular"],
    ...nx.configs["flat/angular-template"],
    ...baseConfig,
    {
        files: ["**/*.ts"],
        rules: {
            "@angular-eslint/directive-selector": [
                "error",
                { type: "attribute", prefix: "hex", style: "camelCase" }
            ],
            "@angular-eslint/component-selector": [
                "error",
                { type: "element", prefix: "hex", style: "kebab-case" }
            ]
        }
    }
];
