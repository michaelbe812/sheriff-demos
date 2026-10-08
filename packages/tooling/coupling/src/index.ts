export { analyze, type AnalyzeOptions, type CouplingReport } from './analyze.ts';
export { CONFIG_FILE, type CouplingConfig, defaultConfig, loadConfig, mergeConfig } from './config.ts';
export type { Finding, FindingKind, Severity, Step } from './findings.ts';
export { toJson, toMarkdown } from './report.ts';
