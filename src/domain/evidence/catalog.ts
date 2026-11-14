import evidenceJson from '../../../data/matrix/evidence.json';
import rulesJson from '../../../data/matrix/rules.json';
import sourcesJson from '../../../data/matrix/sources.resolved.json';
import verificationJson from '../../../data/matrix/verification.json';
import type { SystemId } from '../types';
import type { Evidence, EvidenceWithSource, Rule, Source, VerificationStatus } from './types';

/**
 * The rules matrix, loaded from the JSON files kept in git (`data/matrix/`). Those files
 * are the single source of truth: the SQLite database and this catalog are both built
 * from them. `tests/evidence.test.ts` checks that the data honours the types.
 */
export const RULES = rulesJson as unknown as Rule[];
export const EVIDENCE = evidenceJson as unknown as Evidence[];
export const SOURCES = sourcesJson as unknown as Source[];
const VERIFICATION = verificationJson as Record<string, { status: string } | undefined>;

const sourceById = new Map(SOURCES.map((s) => [s.id, s]));
const evidenceById = new Map(EVIDENCE.map((e) => [e.id, e]));

export const ruleById = (id: string): Rule | undefined => RULES.find((r) => r.id === id);

export const rulesForSystem = (systemId: SystemId): Rule[] => RULES.filter((r) => r.systemId === systemId);

export const verificationOf = (evidenceId: string): VerificationStatus =>
  (VERIFICATION[evidenceId]?.status as VerificationStatus | undefined) ?? 'sin_verificar';

/** Evidence behind a rule, each row joined with its source and verification status. */
export function evidenceFor(rule: Rule): EvidenceWithSource[] {
  const rows: EvidenceWithSource[] = [];
  for (const id of rule.evidenceIds) {
    const evidence = evidenceById.get(id);
    const source = evidence ? sourceById.get(evidence.sourceId) : undefined;
    if (evidence && source) rows.push({ ...evidence, source, verification: verificationOf(id) });
  }
  return rows;
}

/**
 * The evidence that justifies the rule's alert threshold: the standard or clinical
 * criterion when there is one, otherwise the first evidence row. Every alert shows it.
 */
export function primaryEvidence(rule: Rule): EvidenceWithSource | undefined {
  const rows = evidenceFor(rule);
  return rows.find((e) => e.provenanceClass === rule.detect.kind) ?? rows[0];
}
