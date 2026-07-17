import { Provider } from '@angular/core';
import { CHECKIN_API } from './api/checkin-api';
import { HttpCheckinApi } from './infra/http-checkin-api';

/** Slice root (entry, type:feature): wires the port contract to its impl. */
export function provideCheckin(): Provider {
  return { provide: CHECKIN_API, useClass: HttpCheckinApi };
}
