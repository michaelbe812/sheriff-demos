import { type ChangeCoupling, type ChangePair, isChangeCoupled } from './change-coupling.ts';
import type { CouplingConfig } from './config.ts';
import type { ImportEdge } from './imports.ts';
import type { SliceMap } from './slices.ts';
import type { SlicePairEdges, StaticCoupling } from './static-coupling.ts';

/**
 * Indicators for the cut, each mapped to a step towards the target architecture (closed slices,
 * shared below, app composes): merge → fix-direction → move-file → extract-shared → invert → review-cut.
 */
export type FindingKind =
  | 'cycle'
  | 'mutual-dependency'
  | 'merge-candidate'
  | 'depends-on-app'
  | 'shared-depends-on-slice'
  | 'misplaced-file'
  | 'shared-candidate'
  | 'stable-dependency'
  | 'hidden-coupling'
  | 'move-into-slice';

export type Severity = 'high' | 'medium' | 'low';

export type Step = 'merge' | 'fix-direction' | 'move-file' | 'extract-shared' | 'invert' | 'review-cut';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  step: Step;
  slices: string[];
  files: string[];
  /** What was measured (numbers only, reproducible). */
  evidence: string;
  /** What to do in the target architecture. */
  action: string;
}

export interface CutProposal {
  /** Slices that belong together (merge candidates, transitively). */
  clusters: string[][];
  /** Slices that stay on their own. */
  standalone: string[];
}

export const STEP_ORDER: Step[] = ['merge', 'fix-direction', 'move-file', 'extract-shared', 'invert', 'review-cut'];
const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];

const isBarrel = (file: string): boolean => /(^|\/)index\.[cm]?[jt]sx?$/.test(file);

function changePairOf(change: ChangeCoupling, a: string, b: string): ChangePair | undefined {
  const [x, y] = [a, b].sort();
  return change.pairs.find((pair) => pair.a === x && pair.b === y);
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const imports = (n: number): string => count(n, 'Import', 'Importe');
const files = (n: number): string => count(n, 'Datei', 'Dateien');

function describeChange(pair: ChangePair | undefined): string {
  return pair ? `${count(pair.shared, 'gemeinsamer Commit', 'gemeinsame Commits')}, Grad ${pair.degree}` : 'keine gemeinsamen Commits';
}

interface Context {
  config: CouplingConfig;
  slices: SliceMap;
  staticCoupling: StaticCoupling;
  change: ChangeCoupling;
  edges: ImportEdge[];
}

function crossSliceFindings({ config, slices, staticCoupling, change }: Context): Finding[] {
  const findings: Finding[] = [];
  const pairOf = (from: string, to: string) => staticCoupling.pairs.find((pair) => pair.from === from && pair.to === to);
  const sliceNames = staticCoupling.metrics.map(({ slice }) => slice).filter((slice) => slices.roleOf(slice) === 'slice');
  const historyNames = change.slices.map(({ slice }) => slice).filter((slice) => slices.roleOf(slice) === 'slice');
  const all = [...new Set([...sliceNames, ...historyNames])].sort();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a, b] = [all[i], all[j]];
      const ab = pairOf(a, b);
      const ba = pairOf(b, a);
      const changePair = changePairOf(change, a, b);
      const coupled = isChangeCoupled(changePair, config);
      if (ab && ba) {
        findings.push({
          kind: 'mutual-dependency',
          severity: 'high',
          step: 'merge',
          slices: [a, b],
          files: [...ab.targetFiles, ...ba.targetFiles].sort(),
          evidence: `${a}→${b}: ${imports(ab.imports)}, ${b}→${a}: ${imports(ba.imports)}; ${describeChange(changePair)}`,
          action: `${a} und ${b} zusammenlegen, falls fachlich ein Kontext. Sonst Zyklus brechen: gegenseitig genutzte Dateien nach shared ziehen oder in den nutzenden Slice verschieben.`,
        });
      } else if (ab ?? ba) {
        const edge = (ab ?? ba) as SlicePairEdges;
        if (coupled) {
          findings.push({
            kind: 'merge-candidate',
            severity: 'medium',
            step: 'merge',
            slices: [edge.from, edge.to],
            files: edge.targetFiles,
            evidence: `${edge.from}→${edge.to}: ${imports(edge.imports)} aus ${files(edge.sourceFiles.length)}; ${describeChange(changePair)}`,
            action: `${edge.from} nutzt ${edge.to} und beide ändern sich gemeinsam: vermutlich ein Kontext → zusammenlegen oder genutzte Teile nach ${edge.from} holen.`,
          });
        } else {
          findings.push({
            kind: 'stable-dependency',
            severity: 'medium',
            step: 'invert',
            slices: [edge.from, edge.to],
            files: edge.targetFiles,
            evidence: `${edge.from}→${edge.to}: ${imports(edge.imports)} aus ${files(edge.sourceFiles.length)}; ${describeChange(changePair)}`,
            action: `Kante auflösen: fachneutrale Teile (Typen, Utils) nach shared; Fähigkeiten über Contract in shared + DI (App bindet ${edge.to}-Implementierung); UI-Komposition/Navigation in die App-Shell.`,
          });
        }
      } else if (coupled) {
        findings.push({
          kind: 'hidden-coupling',
          severity: 'medium',
          step: 'review-cut',
          slices: [a, b],
          files: change.filePairs.filter((pair) => [pair.sliceA, pair.sliceB].sort().join() === [a, b].join()).flatMap((pair) => [pair.a, pair.b]),
          evidence: `keine Importe, aber ${describeChange(changePair)}`,
          action: `Gemeinsame Änderung ohne Import: Backend-Vertrag, Events, duplizierte Logik? Schnitt prüfen, ggf. zusammenlegen oder Duplikat nach shared.`,
        });
      }
    }
  }
  for (const cycle of staticCoupling.cycles.filter((members) => members.length > 2)) {
    findings.push({
      kind: 'cycle',
      severity: 'high',
      step: 'merge',
      slices: cycle,
      files: [],
      evidence: `Zyklus über ${cycle.length} Slices: ${cycle.join(' ↔ ')}`,
      action: 'Zyklus brechen: zusammengehörige Slices zusammenlegen, Rest über shared oder App-Komposition entkoppeln.',
    });
  }
  return findings;
}

function directionFindings({ slices, staticCoupling }: Context): Finding[] {
  const findings: Finding[] = [];
  for (const pair of staticCoupling.pairs) {
    const fromRole = slices.roleOf(pair.from);
    const toRole = slices.roleOf(pair.to);
    if (fromRole === 'app') continue;
    if (toRole === 'app') {
      findings.push({
        kind: 'depends-on-app',
        severity: 'high',
        step: 'fix-direction',
        slices: [pair.from, pair.to],
        files: pair.targetFiles,
        evidence: `${pair.from}→${pair.to} (App): ${imports(pair.imports)}`,
        action: `Richtung umkehren: was ${pair.from} aus der App braucht, gehört nach shared oder nach ${pair.from}; die App reicht Werte per Input/DI hinein.`,
      });
    } else if (fromRole === 'shared' && toRole === 'slice') {
      findings.push({
        kind: 'shared-depends-on-slice',
        severity: 'high',
        step: 'fix-direction',
        slices: [pair.from, pair.to],
        files: pair.targetFiles,
        evidence: `${pair.from}→${pair.to}: ${imports(pair.imports)} aus ${files(pair.sourceFiles.length)}`,
        action: `shared darf keinen Slice kennen: genutzte Teile von ${pair.to} nach shared ziehen oder die importierende shared-Datei nach ${pair.to} verschieben.`,
      });
    }
  }
  return findings;
}

/** Who imports a file, counted per slice of the importing files. */
function importersBySlice(edges: ImportEdge[], slices: SliceMap): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const { source, target } of edges) {
    const slice = slices.sliceOf(source);
    if (!slice || !slices.sliceOf(target)) continue;
    const counts = result.get(target) ?? new Map<string, number>();
    counts.set(slice, (counts.get(slice) ?? 0) + 1);
    result.set(target, counts);
  }
  return result;
}

function fileFindings({ slices, edges }: Context): Finding[] {
  const findings: Finding[] = [];
  const importers = importersBySlice(edges, slices);
  for (const [file, counts] of [...importers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const owner = slices.sliceOf(file);
    if (!owner) continue;
    const ownerRole = slices.roleOf(owner);
    const consumers = [...counts.keys()].filter((slice) => slice !== owner && slices.roleOf(slice) === 'slice').sort();
    const inside = counts.get(owner) ?? 0;
    if (ownerRole === 'slice' && consumers.length >= 2) {
      findings.push({
        kind: 'shared-candidate',
        severity: 'medium',
        step: 'extract-shared',
        slices: [owner, ...consumers],
        files: [file],
        evidence: `genutzt von ${consumers.map((slice) => `${slice} (${counts.get(slice)})`).join(', ')}; intern ${inside}`,
        action: isBarrel(file)
          ? `Public API von ${owner} wird von mehreren Slices genutzt: konkret genutzte Exporte bestimmen und nach shared (oder eigene Domain-Lib) ziehen.`
          : `Datei nach shared (oder in eine eigene Domain-Lib) ziehen, ${owner} nutzt sie dann ebenfalls von dort.`,
      });
    } else if (ownerRole === 'slice' && consumers.length === 1 && !isBarrel(file) && (counts.get(consumers[0]) ?? 0) > inside) {
      const [consumer] = consumers;
      findings.push({
        kind: 'misplaced-file',
        severity: 'low',
        step: 'move-file',
        slices: [owner, consumer],
        files: [file],
        evidence: `${imports(counts.get(consumer) ?? 0)} aus ${consumer}, ${inside} aus ${owner}`,
        action: `Datei liegt vermutlich falsch (Feature Envy): nach ${consumer} verschieben.`,
      });
    } else if (ownerRole === 'shared') {
      const nonShared = [...counts.keys()].filter((slice) => slices.roleOf(slice) !== 'shared');
      const sliceConsumers = nonShared.filter((slice) => slices.roleOf(slice) === 'slice');
      if (sliceConsumers.length === 1 && nonShared.length === 1 && inside === 0) {
        findings.push({
          kind: 'move-into-slice',
          severity: 'low',
          step: 'move-file',
          slices: [owner, sliceConsumers[0]],
          files: [file],
          evidence: `nur ${sliceConsumers[0]} nutzt ${isBarrel(file) ? 'die Public API' : 'die Datei'} (${imports(counts.get(sliceConsumers[0]) ?? 0)})`,
          action: isBarrel(file)
            ? `Lib wird nur von ${sliceConsumers[0]} genutzt: nach ${sliceConsumers[0]} verschieben, solange kein zweiter Slice sie braucht (shared bleibt klein).`
            : `Gehört nicht nach shared: nach ${sliceConsumers[0]} verschieben (shared bleibt klein).`,
        });
      }
    }
  }
  return findings;
}

export function sortFindings(findings: Finding[]): Finding[] {
  return findings
    .map((finding) => ({ ...finding, slices: finding.slices, files: [...new Set(finding.files)].sort() }))
    .sort(
      (a, b) =>
        STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) ||
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        a.kind.localeCompare(b.kind) ||
        a.slices.join().localeCompare(b.slices.join()) ||
        a.files.join().localeCompare(b.files.join()),
    );
}

/** Slices proposed for merging need no file moves between them (would contradict each other). */
function withoutMovesInsideMerges(findings: Finding[]): Finding[] {
  const merged = findings.filter(({ step }) => step === 'merge').map(({ slices }) => new Set(slices));
  return findings.filter(
    (finding) => finding.kind !== 'misplaced-file' || !merged.some((group) => finding.slices.every((slice) => group.has(slice))),
  );
}

export function deriveFindings(context: Context): Finding[] {
  return sortFindings(withoutMovesInsideMerges([...crossSliceFindings(context), ...directionFindings(context), ...fileFindings(context)]));
}

/** Union-find over merge findings: which slices form one context in the proposed cut. */
export function proposeCut(findings: Finding[], allSlices: string[], slices: SliceMap): CutProposal {
  const parent = new Map(allSlices.map((slice) => [slice, slice]));
  const find = (slice: string): string => {
    let root = slice;
    for (let next = parent.get(root); next !== undefined && next !== root; next = parent.get(root)) root = next;
    return root;
  };
  for (const finding of findings.filter(({ step }) => step === 'merge')) {
    const [first, ...rest] = finding.slices;
    for (const other of rest) {
      const [x, y] = [find(first), find(other)].sort();
      if (x !== y) parent.set(y, x);
    }
  }
  const groups = new Map<string, string[]>();
  for (const slice of allSlices.filter((name) => slices.roleOf(name) === 'slice')) {
    const root = find(slice);
    groups.set(root, [...(groups.get(root) ?? []), slice]);
  }
  const all = [...groups.values()].map((group) => group.sort());
  return {
    clusters: all.filter((group) => group.length > 1).sort((a, b) => a[0].localeCompare(b[0])),
    standalone: all.filter((group) => group.length === 1).map(([slice]) => slice).sort(),
  };
}
