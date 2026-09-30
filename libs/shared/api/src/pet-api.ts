import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { PetService } from '@blueprint/generated/pet-client/api';
import type { Pet } from '@blueprint/generated/pet-client/types';
import { firstValueFrom } from 'rxjs';

/** A pet guests can book a pet-friendly room for — the shared model, not the generated DTO. */
export interface PetSummary {
  id: number;
  name: string;
}

/**
 * Shared api layer over the generated pet-client (libs/generated/pet-client, adapter openapi-tools):
 * Promise instead of Observable, own model, errors as `Error` with the status. Consumers never
 * see the generated service — swapping the adapter changes this file only.
 */
@Injectable({ providedIn: 'root' })
export class PetApi {
  private readonly pets = inject(PetService);

  async availablePets(): Promise<PetSummary[]> {
    try {
      // HttpClient completes WITHOUT a value only when the request was cancelled (injector destroyed)
      const pets: Pet[] = await firstValueFrom(this.pets.findPetsByStatus({ status: 'available' }), {
        defaultValue: [],
      });
      return pets
        .filter((pet): pet is Pet & { id: number } => pet.id !== undefined)
        .map(({ id, name }) => ({ id, name }));
    } catch (error) {
      if (error instanceof HttpErrorResponse) throw new Error(`GET /pet/findByStatus failed: ${error.status}`);
      throw error;
    }
  }
}
