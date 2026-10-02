import { TestBed } from '@angular/core/testing';
import { faker } from '@faker-js/faker';
import { petClientHandlers, petClientHttp } from '@blueprint/generated/pet-client/testing';
import { FAKER_SEED, test, worker } from '@blueprint/shared/testing';
import { beforeEach, describe, expect } from 'vitest';
import { PetApi } from './pet-api';

describe('PetApi (generated pet-client)', () => {
  // generated default handlers: every Petstore operation answers with the spec examples, faker fills the rest
  beforeEach(() => worker.use(...petClientHandlers));

  test('loads available pets through the generated handlers, deterministic per seed', async () => {
    const api = TestBed.inject(PetApi);

    const first = await api.availablePets();
    faker.seed(FAKER_SEED);
    const second = await api.availablePets();

    expect(first.length).toBeGreaterThan(0);
    expect(first.every((pet) => pet.name === 'doggie')).toBe(true); // `example` of Pet.name in the spec
    expect(second).toEqual(first);
  });

  test('sends status=available (typed scenario: only documented paths, query and bodies compile)', async ({
    worker,
  }) => {
    worker.use(
      petClientHttp.get('/pet/findByStatus', ({ query, response }) =>
        response(200).json([
          { id: 7, name: query.get('status') === 'available' ? 'Rex' : 'wrong status', photoUrls: [] },
        ]),
      ),
    );

    expect(await TestBed.inject(PetApi).availablePets()).toEqual([{ id: 7, name: 'Rex' }]);
  });

  test('turns a documented error status into an Error', async ({ worker }) => {
    worker.use(petClientHttp.get('/pet/findByStatus', ({ response }) => response(400).empty()));

    await expect(TestBed.inject(PetApi).availablePets()).rejects.toThrow('GET /pet/findByStatus failed: 400');
  });
});
