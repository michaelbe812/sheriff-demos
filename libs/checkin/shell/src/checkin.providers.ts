import { Provider } from '@angular/core';
import { CHECKIN_API } from '@blueprint/checkin/api';
import { HttpCheckinApi } from '@blueprint/checkin/infra';

/** Slice root (type:shell): wires the port contract to its impl. */
export function provideCheckin(): Provider {
  return { provide: CHECKIN_API, useClass: HttpCheckinApi };
}
