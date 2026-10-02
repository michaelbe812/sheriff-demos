/** Signed-in user — shared, because more than one slice shows it (slices never import each other). */
export interface AuthUser {
  id: string;
  name: string;
}
