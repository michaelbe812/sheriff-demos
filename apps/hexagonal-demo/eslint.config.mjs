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
        // Nx runs ESLint from the workspace root, so this glob must be
        // root-relative. A project-relative one ("src/app/...") silently
        // matches nothing and the rule never fires — found by probing it.
        //
        // TODO(sheriff-fork): replace this whole block with `externalRules`
        // once it is upstream. Our fork (@lambda-solutions/sheriff-core,
        // check-for-external-rule-violation.ts) governs node_modules imports
        // by tag, which is exactly the gap this rule patches:
        //
        //   externalRules: { 'type:domain': [] }   // core: no external deps
        //
        // Verified in the fork's source: externalRules AND-combine across a
        // module's tags (`if (!isAllowed) return false`) — the inverse of
        // depRules, so they genuinely restrict. A tag without an entry stays
        // unrestricted, so adopting it is non-breaking.
        //
        // Worth doing beyond taste: the glob above already failed silently
        // once (project-relative vs. root-relative). externalRules move the
        // guarantee into the same tag system as every other boundary, with no
        // second path-matching scheme to get wrong.
        //
        // Not applied here: this repo stays on upstream @softarc/sheriff-core
        // 0.19.6 and must run without the fork.
        files: ["**/apps/hexagonal-demo/src/app/domains/*/domain/**/*.ts"],
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
