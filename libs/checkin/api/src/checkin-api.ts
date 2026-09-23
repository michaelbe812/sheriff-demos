import { inject, Injectable } from '@angular/core';
import { ApiHttp } from '../../../shared/api/http-client';

/** PUBLIC PORT of the checkin domain — cross-domain types re-exported here. */
export type { CheckinRecord } from '../types/checkin.model';

/** Raw backend shape; mapped to the domain model in data/internal. */
export interface CheckinDto {
  id: string;
  booking_id: string;
  guest_name: string;
  checked_in_at: string;
}

@Injectable({ providedIn: 'root' })
export class CheckinApi {
  private readonly http = inject(ApiHttp);

  loadCheckins(): Promise<CheckinDto[]> {
    return this.http.get<CheckinDto[]>('/api/checkins');
  }
}
