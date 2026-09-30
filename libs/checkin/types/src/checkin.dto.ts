/** Raw backend shape of a check-in; mapped to CheckinRecord in data/internal. */
export interface CheckinDto {
  id: string;
  booking_id: string;
  guest_name: string;
  checked_in_at: string;
}
