import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BookingsService } from '@blueprint/booking/generated/booking-client/api';
import type { Booking as BookingDto } from '@blueprint/booking/generated/booking-client/types';
import { Booking } from '@blueprint/booking/types';
import { firstValueFrom } from 'rxjs';

/**
 * PUBLIC PORT of the booking domain: the only module other domains may
 * import. Cross-domain needed types are re-exported here — the types bucket
 * itself stays private.
 *
 * Backed by the generated booking-client (tools/openapi-facade, adapter
 * openapi-tools). The port keeps its own contract (Promise, domain Booking,
 * Error with status): the generated service API stays behind it.
 */
export type { Booking } from '@blueprint/booking/types';

@Injectable({ providedIn: 'root' })
export class BookingApi {
  private readonly bookings = inject(BookingsService);

  async loadBookings(): Promise<Booking[]> {
    try {
      // HttpClient completes WITHOUT a value only when the request was cancelled (injector destroyed:
      // app teardown, TestBed reset between specs) — nothing to load then, instead of an EmptyError
      return (await firstValueFrom(this.bookings.listBookings(), { defaultValue: [] })).map(toBooking);
    } catch (error) {
      if (error instanceof HttpErrorResponse) throw new Error(`GET /api/bookings failed: ${error.status}`);
      throw error;
    }
  }
}

/** Anti-corruption: generated DTO → domain model (identical today, free to diverge). */
function toBooking(dto: BookingDto): Booking {
  return { id: dto.id, guestName: dto.guestName, checkinDate: dto.checkinDate, status: dto.status };
}
