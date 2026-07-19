import nx from "@nx/eslint-plugin";
import baseConfig from "../../eslint.config.mjs";

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
    },
    // NOTE: the strict hexagon backed up "core knows no framework" with a
    // no-restricted-imports rule against @angular/* and rxjs on domain/**.
    // This variant deliberately allows the core to use Angular, so that rule
    // is gone. Every remaining boundary — including "core must not reach an
    // adapter" — is enforced by Sheriff's depRules (type:domain has no
    // clearance towards type:adapter-*), which the tag system covers fully
    // here because there is no node_modules edge case left to guard.
    {
        files: ["**/*.html"],
        rules: {}
    }
];
