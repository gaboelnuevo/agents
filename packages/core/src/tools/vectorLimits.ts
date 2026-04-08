/** Hard cap on `vector_search` `topK` to limit embedding/vector API cost under adversarial or buggy prompts. */
export const MAX_VECTOR_TOPK = 50;

/** Max documents per `vector_upsert` call (batch size). */
export const MAX_VECTOR_UPSERT_DOCS = 100;

/** Max IDs per `vector_delete` when using the `ids` selector. */
export const MAX_VECTOR_DELETE_IDS = 100;

export function clampVectorTopK(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 5;
  return Math.min(Math.max(1, n), MAX_VECTOR_TOPK);
}

/** True when input has a non-empty, bounded `ids` list and/or a non-empty metadata `filter`. */
export function isValidVectorDeleteInput(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const o = input as Record<string, unknown>;

  if ("ids" in o && o.ids !== undefined && !Array.isArray(o.ids)) return false;
  if (o.filter !== undefined && o.filter !== null) {
    const f = o.filter;
    if (typeof f !== "object" || Array.isArray(f)) return false;
  }

  let idsOk = false;
  if (Array.isArray(o.ids)) {
    if (o.ids.length > MAX_VECTOR_DELETE_IDS) return false;
    if (o.ids.length > 0) {
      if (!o.ids.every((id) => typeof id === "string" && id.trim().length > 0))
        return false;
      idsOk = true;
    }
  }

  let filterOk = false;
  if (o.filter !== undefined && o.filter !== null) {
    const f = o.filter as Record<string, unknown>;
    if (Object.keys(f).length === 0) return false;
    filterOk = true;
  }

  return idsOk || filterOk;
}
