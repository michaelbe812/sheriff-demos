#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
/**
 * Usage: node --experimental-strip-types packages/tooling/coupling/src/cli.ts [options]
 *   --repo <path>        repo to analyze (default: cwd)
 *   --config <file>      config (default: <repo>/coupling.config.json, else defaults)
 *   --out <dir>          writes coupling-report.json + coupling-report.md (default: print markdown)
 *   --range <rev>        git range, overrides config (pin a sha for reproducible reports)
 *   --max-commits <n>    newest n commits only
 *   --detective          add Detective's matrices as cross-check (headless)
 *   --detective-serve    seed Detective with the slices and open its UI (no report)
 *   --fail-on <sev>      exit 1 if a finding has this severity or higher (high|medium|low)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from './analyze.ts';
import { loadConfig } from './config.ts';
import { serveDetective } from './detective.ts';
import type { Severity } from './findings.ts';
import { trackedFiles } from './repo.ts';
import { toJson, toMarkdown } from './report.ts';
import { createSliceMap } from './slices.ts';

const SEVERITIES: Severity[] = ['high', 'medium', 'low'];

const { values } = parseArgs({
  options: {
    repo: { type: 'string', default: process.cwd() },
    config: { type: 'string' },
    out: { type: 'string' },
    range: { type: 'string' },
    'max-commits': { type: 'string' },
    detective: { type: 'boolean', default: false },
    'detective-serve': { type: 'boolean', default: false },
    'fail-on': { type: 'string' },
  },
});

const repo = resolve(values.repo ?? process.cwd());
const config = loadConfig(repo, values.config && resolve(values.config));
if (values.range) config.git.range = values.range;
if (values['max-commits']) config.git.maxCommits = Number(values['max-commits']);

if (values['detective-serve']) {
  serveDetective(repo, createSliceMap(repo, config, trackedFiles(repo)), config);
} else {
  const report = await analyze({ repo, config, detective: values.detective });
  const markdown = toMarkdown(report);
  if (values.out) {
    const out = resolve(values.out);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'coupling-report.json'), toJson(report));
    writeFileSync(join(out, 'coupling-report.md'), markdown);
    console.log(`coupling: ${report.findings.length} findings, ${report.proposal.clusters.length} merge clusters → ${out}`);
  } else {
    process.stdout.write(markdown);
  }
  const failOn = values['fail-on'] as Severity | undefined;
  if (failOn) {
    if (!SEVERITIES.includes(failOn)) throw new Error(`--fail-on: one of ${SEVERITIES.join(', ')}`);
    const limit = SEVERITIES.indexOf(failOn);
    const failing = report.findings.filter((finding) => SEVERITIES.indexOf(finding.severity) <= limit);
    if (failing.length) {
      console.error(`coupling: ${failing.length} findings with severity ≥ ${failOn}`);
      process.exitCode = 1;
    }
  }
}
