import { libFile, ruleTester } from '../testing/rule-tester';
import { noInternalExport, RULE_NAME } from './no-internal-export';

const index = libFile('checkin/state/src/index.ts');

ruleTester.run(RULE_NAME, noInternalExport, {
  valid: [
    { code: "export * from './checkin.store';", filename: index },
    { code: "export { CheckinStore } from './checkin.store';", filename: index },
    { code: "export type { Booking } from '@blueprint/booking/types';", filename: index },
    // `internal` as a file name part is no folder
    { code: "export * from './internal-notes';", filename: index },
    // inside the lib internal/ is free — only the public API is checked
    { code: "export * from './internal/checkin.mapper';", filename: libFile('checkin/state/src/checkin.store.ts') },
    { code: "export * from './internal/checkin.mapper';", filename: libFile('checkin/state/src/sub/index.ts') },
  ],
  invalid: [
    {
      code: "export * from './internal/checkin.mapper';",
      filename: index,
      errors: [{ messageId: 'internalExport', data: { lib: 'libs/checkin/state', source: './internal/checkin.mapper' } }],
    },
    { code: "export { toCheckinRecord } from './internal/checkin.mapper';", filename: index, errors: [{ messageId: 'internalExport' }] },
    { code: "export * from './internal';", filename: index, errors: [{ messageId: 'internalExport' }] },
    { code: "export * from './sub/internal/x';", filename: index, errors: [{ messageId: 'internalExport' }] },
    {
      code: "import { toCheckinRecord } from './internal/checkin.mapper';\nexport { toCheckinRecord };",
      filename: index,
      errors: [{ messageId: 'internalExport', line: 1 }],
    },
  ],
});
