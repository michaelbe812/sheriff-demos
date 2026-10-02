// boundary-violation-example: import { ApiHttp } from '@blueprint/shared/data-access'; // utils -> data-access

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
