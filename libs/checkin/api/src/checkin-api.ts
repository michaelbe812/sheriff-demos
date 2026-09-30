import { inject, Injectable } from '@angular/core';
import { ApiHttp } from '@blueprint/shared/api';
import { CheckinDto } from '@blueprint/checkin/types';

/** PUBLIC PORT of the checkin domain — cross-domain types re-exported here. */
export type { CheckinRecord } from '@blueprint/checkin/types';

@Injectable({ providedIn: 'root' })
export class CheckinApi {
  private readonly http = inject(ApiHttp);

  loadCheckins(): Promise<CheckinDto[]> {
    return this.http.get<CheckinDto[]>('/api/checkins');
  }
}
