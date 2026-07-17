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
    {
        // Sheriff's depRules govern project-INTERNAL module imports. An import
        // of `@angular/core` resolves into node_modules and is not reliably
        // caught by the tag system, so the "domain core knows no framework"
        // guarantee is backed up here. This is the one rule the tag axes
        // cannot fully carry on their own.
        files: ["src/app/domains/*/domain/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["@angular/*"],
                            message: "Domain core must not depend on Angular."
                        },
                        {
                            group: ["rxjs", "rxjs/*"],
                            message: "Domain core must not depend on rxjs."
                        },
                        {
                            group: ["**/application/**", "**/ports/**", "**/adapters/**", "**/shared/**"],
                            message: "Domain core must not depend on outer layers."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: ["**/*.html"],
        rules: {}
    }
];
