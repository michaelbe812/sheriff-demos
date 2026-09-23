// boundary-violation-example: import { ApiHttp } from '@blueprint/shared/api'; // utils -> api

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
