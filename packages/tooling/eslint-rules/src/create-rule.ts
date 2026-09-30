import { ESLintUtils } from '@typescript-eslint/utils';

/** Docs anchor per rule: packages/tooling/eslint-rules/README.md#<rule>. */
export const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/michaelbe812/sheriff-demos/blob/feat/nx-blueprint/packages/tooling/eslint-rules/README.md#${name}`,
);
