import { inject, Injectable } from '@angular/core';
import { ApiHttp } from '@blueprint/shared/api';
import { CheckinApi, CheckinDto } from '@blueprint/checkin/api';

/**
 * The port's implementation (type:infra) — the only place that knows the
 * backend exists. Not tagged `port`, so it is invisible to other domains.
 */
@Injectable({ providedIn: 'root' })
export class HttpCheckinApi implements CheckinApi {
  private readonly http = inject(ApiHttp);

  loadCheckins(): Promise<CheckinDto[]> {
    return this.http.get<CheckinDto[]>('/api/checkins');
  }
}
