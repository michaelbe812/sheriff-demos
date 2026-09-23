// sheriff-violation-example: import { ApiHttp } from '../api/http-client'; // utils -> api

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
