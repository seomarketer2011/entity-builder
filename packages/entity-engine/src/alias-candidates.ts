/**
 * Alias-candidate detection: given raw extracted terms and existing
 * entities, propose merges for human review. Nothing here auto-approves —
 * output is review-queue material (docs/ENTITY_SYSTEM.md).
 */

import type { Entity } from "@entity-builder/domain";
import { normalizeTerm, tokenSimilarity } from "./normalize.js";

export interface AliasCandidate {
  rawTerm: string;
  entityId: string;
  entityName: string;
  matchKind: "exact_normalised" | "existing_alias" | "high_similarity";
  similarity: number;
}

export interface NewEntityCandidate {
  rawTerm: string;
  nearestEntityId?: string;
  nearestEntityName?: string;
  nearestSimilarity: number;
}

export interface CandidateTriageResult {
  aliasCandidates: AliasCandidate[];
  newEntityCandidates: NewEntityCandidate[];
}

/** Above this, a term is proposed as an alias; below, as a possible new entity. */
export const ALIAS_SIMILARITY_THRESHOLD = 0.6;

export function triageCandidates(
  rawTerms: string[],
  entities: Entity[],
): CandidateTriageResult {
  const aliasCandidates: AliasCandidate[] = [];
  const newEntityCandidates: NewEntityCandidate[] = [];

  const seen = new Set<string>();
  for (const rawTerm of rawTerms) {
    const normalized = normalizeTerm(rawTerm);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);

    let best: AliasCandidate | undefined;
    let nearest: { entity: Entity; similarity: number } | undefined;

    for (const entity of entities) {
      if (normalizeTerm(entity.canonicalName) === normalized) {
        best = {
          rawTerm,
          entityId: entity.id,
          entityName: entity.canonicalName,
          matchKind: "exact_normalised",
          similarity: 1,
        };
        break;
      }
      if (entity.aliases.some((a) => normalizeTerm(a) === normalized)) {
        best = {
          rawTerm,
          entityId: entity.id,
          entityName: entity.canonicalName,
          matchKind: "existing_alias",
          similarity: 1,
        };
        break;
      }
      const candidates = [entity.canonicalName, ...entity.aliases];
      const similarity = Math.max(
        ...candidates.map((c) => tokenSimilarity(rawTerm, c)),
      );
      if (!nearest || similarity > nearest.similarity) {
        nearest = { entity, similarity };
      }
    }

    if (!best && nearest && nearest.similarity >= ALIAS_SIMILARITY_THRESHOLD) {
      best = {
        rawTerm,
        entityId: nearest.entity.id,
        entityName: nearest.entity.canonicalName,
        matchKind: "high_similarity",
        similarity: Math.round(nearest.similarity * 100) / 100,
      };
    }

    if (best) {
      aliasCandidates.push(best);
    } else {
      newEntityCandidates.push({
        rawTerm,
        nearestEntityId: nearest?.entity.id,
        nearestEntityName: nearest?.entity.canonicalName,
        nearestSimilarity: Math.round((nearest?.similarity ?? 0) * 100) / 100,
      });
    }
  }

  return { aliasCandidates, newEntityCandidates };
}
