import { inject, Injectable } from '@angular/core';
import { ApiHttp } from '../../../shared/api/http-client';
import { CheckinApi, CheckinDto } from '../api/checkin-api';

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
