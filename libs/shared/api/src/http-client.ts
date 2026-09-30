import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ApiHttp {
  async get<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GET ${url} failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
