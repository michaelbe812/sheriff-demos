// Hasher des Executors `@blueprint/tooling-ng-lib:test` (executors.json → `hasher`).
//
// Vitest UI läuft über dasselbe Target (`nx run <lib>:test --ui`), das Target ist gecacht. Nx hasht die
// Overrides mit: ein UI-Lauf trifft nie den Eintrag des normalen `test` (und umgekehrt). Beendet man die
// UI aber regulär (Vitest `q`), meldet der Builder Erfolg und Nx würde den Lauf unter dem UI-Hash cachen;
// der nächste `--ui`-Aufruf spielte dann nur die alte Ausgabe ab, statt die UI zu starten.
// Deshalb bekommt jeder UI-Lauf einen einmaligen Hash: nie ein Cache-Treffer. Ohne `ui` unverändert der
// Standard-Hash von Nx (Inputs aus der Target-Config).
const { randomUUID } = require('crypto');
const { hashArray } = require('@nx/devkit');

async function ngLibTestHasher(task, context) {
  const hash = await context.hasher.hashTask(task, context.taskGraph, context.env);
  if (!task.overrides?.ui) return hash;
  return { ...hash, value: hashArray([hash.value, 'vitest:ui', randomUUID()]) };
}

module.exports = ngLibTestHasher;
module.exports.default = ngLibTestHasher;
