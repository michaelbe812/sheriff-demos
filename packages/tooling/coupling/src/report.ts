import type { CouplingReport } from './analyze.ts';
import { type Finding, STEP_ORDER, type Step } from './findings.ts';
import type { SliceRole } from './slices.ts';

const STEP_TITLES: Record<Step, string> = {
  merge: '1. Zusammenlegen (Schnitt korrigieren)',
  'fix-direction': '2. Richtung korrigieren (shared/App hängen nicht an Slices)',
  'move-file': '3. Dateien verschieben',
  'extract-shared': '4. Nach shared ziehen',
  invert: '5. Restliche Kanten auflösen (Contract + DI, App-Komposition)',
  'review-cut': '6. Verdeckte Kopplung prüfen',
};

const SEVERITY_ICON = { high: '🔴', medium: '🟠', low: '🟡' } as const;

export function toJson(report: CouplingReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Edge is fine in the target architecture: into shared, out of the app. */
export function isExpectedEdge(fromRole: SliceRole, toRole: SliceRole): boolean {
  return fromRole === 'app' || (toRole === 'shared' && fromRole !== 'shared') || (fromRole === 'shared' && toRole === 'shared');
}

const cell = (value: unknown): string => String(value ?? '–').replace(/\|/g, '\\|');
const table = (head: string[], rows: unknown[][]): string =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n');
const fileList = (files: string[], max: number): string =>
  files.length ? `${files.slice(0, max).map((file) => `\`${file}\``).join(', ')}${files.length > max ? ` (+${files.length - max})` : ''}` : '';

function mermaid(report: CouplingReport): string {
  const roleOf = new Map(report.slices.map(({ slice, role }) => [slice, role]));
  const id = (slice: string) => `s_${slice.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const lines = ['```mermaid', 'graph LR'];
  for (const { slice, role } of report.slices) lines.push(`  ${id(slice)}["${slice}${role === 'slice' ? '' : ` (${role})`}"]`);
  report.staticCoupling.pairs.forEach((pair) => {
    const expected = isExpectedEdge(roleOf.get(pair.from) ?? 'slice', roleOf.get(pair.to) ?? 'slice');
    lines.push(`  ${id(pair.from)} ${expected ? '-.->' : '==>'}|${pair.imports}| ${id(pair.to)}`);
  });
  const unexpected = report.staticCoupling.pairs
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair }) => !isExpectedEdge(roleOf.get(pair.from) ?? 'slice', roleOf.get(pair.to) ?? 'slice'))
    .map(({ index }) => index);
  if (unexpected.length) lines.push(`  linkStyle ${unexpected.join(',')} stroke:#d33,stroke-width:2px`);
  lines.push('```');
  return lines.join('\n');
}

function findingBlock(finding: Finding): string {
  const files = fileList(finding.files, 8);
  return [
    `- ${SEVERITY_ICON[finding.severity]} **${finding.kind}** · ${finding.slices.join(' ↔ ')}`,
    `  - Messung: ${finding.evidence}`,
    `  - Maßnahme: ${finding.action}`,
    ...(files ? [`  - Dateien: ${files}`] : []),
  ].join('\n');
}

export function toMarkdown(report: CouplingReport): string {
  const { meta, staticCoupling, changeCoupling, findings, proposal } = report;
  const roleOf = new Map(report.slices.map(({ slice, role }) => [slice, role]));
  const crossSlice = staticCoupling.pairs.filter((pair) => !isExpectedEdge(roleOf.get(pair.from) ?? 'slice', roleOf.get(pair.to) ?? 'slice'));
  const historyOf = new Map(changeCoupling.slices.map((history) => [history.slice, history]));
  const metricsOf = new Map(staticCoupling.metrics.map((metrics) => [metrics.slice, metrics]));
  const out: string[] = [];
  out.push(`# Schnitt-Analyse: ${meta.repo}`, '');
  out.push(
    table(
      ['HEAD', 'Slices aus', 'Dateien', 'ohne Slice', 'Commits (analysiert/gelesen)', 'Range'],
      [[meta.head.slice(0, 10), meta.sliceMode, meta.analyzedFiles, meta.unassignedFiles, `${meta.commitsAnalyzed}/${meta.commitsRead}`, meta.config.git.range]],
    ),
    '',
  );
  if (meta.unassignedFolders.length) {
    out.push(`Ohne Slice (Top-Ordner, ggf. \`slices\` in \`coupling.config.json\` anpassen): ${meta.unassignedFolders.map(({ folder, files }) => `\`${folder}\` (${files})`).join(', ')}`, '');
  }
  out.push('## Zusammenfassung', '');
  const byStep = STEP_ORDER.map((step) => [STEP_TITLES[step], findings.filter((finding) => finding.step === step).length]);
  out.push(
    `- **${crossSlice.length}** unerwartete Kanten zwischen Slices (Ziel: 0), ${staticCoupling.cycles.length} Zyklen`,
    `- **${changeCoupling.pairs.filter((pair) => pair.shared >= meta.config.thresholds.minSharedCommits && pair.degree >= meta.config.thresholds.changeCouplingDegree).length}** change-gekoppelte Slice-Paare (≥ ${meta.config.thresholds.minSharedCommits} Commits, Grad ≥ ${meta.config.thresholds.changeCouplingDegree})`,
    `- **${findings.length}** Indizien`,
    '',
    table(['Schritt', 'Indizien'], byStep),
    '',
  );
  out.push('## Schnittvorschlag', '');
  if (proposal.clusters.length) {
    out.push('Diese Slices gehören vermutlich zusammen (gegenseitige Abhängigkeit, Zyklus oder Import plus gemeinsame Änderung):', '');
    for (const cluster of proposal.clusters) out.push(`- **${cluster.join(' + ')}**`);
  } else {
    out.push('Keine Slices zum Zusammenlegen.');
  }
  out.push('', `Eigenständig: ${proposal.standalone.join(', ') || '–'}`, '');
  out.push('## Überführung in die Zielarchitektur', '');
  out.push('Ziel: Slices geschlossen (kein Import zwischen Slices), shared unten, App komponiert. Reihenfolge:', '');
  for (const step of STEP_ORDER) {
    const stepFindings = findings.filter((finding) => finding.step === step);
    if (!stepFindings.length) continue;
    out.push(`### ${STEP_TITLES[step]}`, '', ...stepFindings.map(findingBlock), '');
  }
  if (!findings.length) out.push('Keine Indizien: Der Schnitt entspricht der Zielarchitektur.', '');
  out.push('## Slices', '');
  out.push(
    table(
      ['Slice', 'Rolle', 'Dateien', 'Ca', 'Ce', 'I', 'Commits', 'Autoren', 'Hauptautor-Anteil', 'SoC'],
      report.slices.map(({ slice, role }) => {
        const metrics = metricsOf.get(slice);
        const history = historyOf.get(slice);
        return [slice, role, metrics?.files, metrics?.afferent, metrics?.efferent, metrics?.instability, history?.revisions, history?.authors, history?.mainAuthorShare, history?.sumOfCoupling];
      }),
    ),
    '',
    'Ca/Ce = Dateien außerhalb, die importieren / importiert werden; I = Ce/(Ca+Ce) (Martin). SoC = Sum of Coupling (Tornhill).',
    '',
  );
  out.push('## Importe zwischen Slices', '', mermaid(report), '', 'Rot/dick = unerwartet in der Zielarchitektur, gestrichelt = erwartet (→ shared, App →).', '');
  if (staticCoupling.pairs.length) {
    out.push(
      table(
        ['von', 'nach', 'erwartet', 'Importe', 'Quelldateien', 'Zieldateien'],
        staticCoupling.pairs.map((pair) => [
          pair.from,
          pair.to,
          isExpectedEdge(roleOf.get(pair.from) ?? 'slice', roleOf.get(pair.to) ?? 'slice') ? 'ja' : '**nein**',
          pair.imports,
          pair.sourceFiles.length,
          pair.targetFiles.length,
        ]),
      ),
      '',
    );
  }
  out.push('## Change Coupling', '');
  if (changeCoupling.pairs.length) {
    out.push(table(['Slice A', 'Slice B', 'gemeinsam', 'Commits A', 'Commits B', 'Grad'], changeCoupling.pairs.map((p) => [p.a, p.b, p.shared, p.revisionsA, p.revisionsB, p.degree])), '');
  } else {
    out.push('Keine Commits über Slice-Grenzen.', '');
  }
  if (changeCoupling.filePairs.length) {
    out.push(
      '### Dateien über Slice-Grenzen',
      '',
      table(
        ['Datei A', 'Datei B', 'gemeinsam', 'Grad'],
        changeCoupling.filePairs.slice(0, meta.config.thresholds.maxListed).map((p) => [`\`${p.a}\``, `\`${p.b}\``, p.shared, p.degree]),
      ),
      '',
    );
  }
  if (report.detective) {
    const detective = report.detective;
    const changeOf = (a: string, b: string) => changeCoupling.pairs.find((pair) => pair.a === a && pair.b === b)?.shared ?? 0;
    const importsOf = (from: string, to: string) => staticCoupling.pairs.find((pair) => pair.from === from && pair.to === to)?.imports ?? 0;
    out.push(`## Detective ${detective.version} (Gegenprobe)`, '', `Scopes: ${detective.scopes.map((scope) => `\`${scope}\``).join(', ')}`, '');
    out.push(table(['von', 'nach', 'Importe (eigene)', 'Importe (Detective)'], detective.coupling.map((pair) => [pair.from, pair.to, importsOf(pair.from, pair.to), pair.imports])), '');
    out.push(
      table(['Slice A', 'Slice B', 'gemeinsame Commits (eigene, gefiltert)', 'gemeinsame Commits (Detective, roh)'], detective.changeCoupling.map((pair) => [pair.a, pair.b, changeOf(pair.a, pair.b), pair.shared])),
      '',
      'Detective zählt pro Ordner ohne Commit-Filter (große Commits zählen mit); eigene Zahlen nach `maxFilesPerCommit`/`ignoreMessages`.',
      '',
    );
  }
  return `${out.join('\n').trim()}\n`;
}
