import type { ImportEdge } from './imports.ts';
import type { SliceMap } from './slices.ts';

/** Imports from one slice into another, aggregated. */
export interface SlicePairEdges {
  from: string;
  to: string;
  /** Number of import statements. */
  imports: number;
  sourceFiles: string[];
  targetFiles: string[];
  edges: ImportEdge[];
}

/** Robert C. Martin: Ca = files outside importing the slice, Ce = files outside the slice imports, I = Ce / (Ca + Ce). */
export interface SliceStaticMetrics {
  slice: string;
  files: number;
  internalImports: number;
  afferent: number;
  efferent: number;
  /** null when the slice neither imports nor is imported across slices. */
  instability: number | null;
}

export interface StaticCoupling {
  pairs: SlicePairEdges[];
  metrics: SliceStaticMetrics[];
  /** Strongly connected slice groups (> 1 slice): mutual dependencies, directly or via others. */
  cycles: string[][];
}

const pairKey = (from: string, to: string): string => `${from}\0${to}`;

function addTo(sets: Map<string, Set<string>>, key: string, value: string): void {
  const set = sets.get(key) ?? new Set<string>();
  set.add(value);
  sets.set(key, set);
}

export function calcStaticCoupling(edges: ImportEdge[], files: string[], slices: SliceMap): StaticCoupling {
  const filesPerSlice = new Map<string, number>();
  for (const file of files) {
    const slice = slices.sliceOf(file);
    if (slice) filesPerSlice.set(slice, (filesPerSlice.get(slice) ?? 0) + 1);
  }
  const pairs = new Map<string, SlicePairEdges>();
  const internal = new Map<string, number>();
  const afferent = new Map<string, Set<string>>();
  const efferent = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = slices.sliceOf(edge.source);
    const to = slices.sliceOf(edge.target);
    if (!from || !to) continue;
    if (from === to) {
      internal.set(from, (internal.get(from) ?? 0) + 1);
      continue;
    }
    const key = pairKey(from, to);
    const pair = pairs.get(key) ?? { from, to, imports: 0, sourceFiles: [], targetFiles: [], edges: [] };
    pair.imports++;
    pair.edges.push(edge);
    pairs.set(key, pair);
    addTo(efferent, from, edge.target);
    addTo(afferent, to, edge.source);
  }
  const sortedPairs = [...pairs.values()]
    .map((pair) => ({
      ...pair,
      sourceFiles: [...new Set(pair.edges.map(({ source }) => source))].sort(),
      targetFiles: [...new Set(pair.edges.map(({ target }) => target))].sort(),
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const metrics = [...filesPerSlice.keys()].sort().map((slice) => {
    const ca = afferent.get(slice)?.size ?? 0;
    const ce = efferent.get(slice)?.size ?? 0;
    return {
      slice,
      files: filesPerSlice.get(slice) ?? 0,
      internalImports: internal.get(slice) ?? 0,
      afferent: ca,
      efferent: ce,
      instability: ca + ce === 0 ? null : round(ce / (ca + ce)),
    };
  });
  return { pairs: sortedPairs, metrics, cycles: findCycles(sortedPairs) };
}

export const round = (value: number): number => Math.round(value * 100) / 100;

/** Tarjan's SCC on the slice graph; deterministic thanks to sorted input. */
export function findCycles(pairs: { from: string; to: string }[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const { from, to } of pairs) {
    graph.set(from, [...(graph.get(from) ?? []), to]);
    if (!graph.has(to)) graph.set(to, []);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const lowOf = (node: string): number => low.get(node) ?? Infinity;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  let counter = 0;
  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter++);
    stack.push(node);
    onStack.add(node);
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(lowOf(node), lowOf(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(lowOf(node), index.get(next) ?? Infinity));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) result.push(component.sort());
    }
  };
  for (const node of [...graph.keys()].sort()) if (!index.has(node)) visit(node);
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}
