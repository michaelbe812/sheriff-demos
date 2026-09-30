/** RuleTester on Vitest, workspace root `/ws` (virtual files, no disk access). */
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

export const ruleTester = new RuleTester({ settings: { blueprint: { workspaceRoot: '/ws' } } });

/** absolute path of a file below libs/ of the virtual workspace */
export const libFile = (path: string): string => `/ws/libs/${path}`;
