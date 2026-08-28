export type FlightRecordMap = Map<string, unknown>;

/**
 * LinkedIn responses we've observed can arrive as:
 *
 * 1. Raw React Flight / RSC:
 *
 *    1:I[...]
 *    0:["$","div",...]
 *
 * 2. Base64 containing the same Flight/RSC text.
 *
 * This function converts both into one canonical RSC string.
 */
export function normalizeRscResponse(body: string): string {
  const value = body.trim();

  if (!value) {
    throw new Error("LinkedIn returned an empty response");
  }

  if (looksLikeFlight(value)) {
    return value;
  }

  const base64Candidate = normalizeBase64Candidate(value);

  if (base64Candidate && looksLikeBase64(base64Candidate)) {
    try {
      const decoded = Buffer.from(base64Candidate, "base64").toString("utf8");

      if (looksLikeFlight(decoded)) {
        return decoded.trim();
      }
    } catch {
      // Fall through to error below.
    }
  }

  throw new Error(
    "Unknown LinkedIn response format: response is neither raw RSC nor base64 RSC"
  );
}

function normalizeBase64Candidate(value: string): string | null {
  let candidate = value.trim();

  // Sometimes copied/exported responses may be surrounded
  // by a JSON/string quote.
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1);
  }

  candidate = candidate.replace(/\s+/g, "");

  return candidate || null;
}

function looksLikeFlight(value: string): boolean {
  const text = value.trim();

  // Covers records such as:
  // 0:[...]
  // 1:I[...]
  // 2:null
  // a:"$Sreact.fragment"
  //
  // Flight record IDs are generally hexadecimal.
  return /(?:^|\n)[0-9a-f]+:(?:I)?(?:\[|\{|null|"|\$)/i.test(text);
}

function looksLikeBase64(value: string): boolean {
  if (value.length < 16) {
    return false;
  }

  // Missing = padding is valid in many base64 implementations,
  // so don't require length % 4 === 0.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * Converts Flight text into a map:
 *
 * 0 -> root
 * 6 -> Experience section
 * e -> collection
 * 11 -> another referenced chunk
 * ...
 */
export function parseFlightRecords(rsc: string): FlightRecordMap {
  const records: FlightRecordMap = new Map();

  for (const rawLine of rsc.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const separator = line.indexOf(":");

    if (separator <= 0) {
      continue;
    }

    const id = line.slice(0, separator).trim().toLowerCase();

    if (!/^[0-9a-f]+$/i.test(id)) {
      continue;
    }

    const payload = line.slice(separator + 1).trim();

    if (!payload) {
      continue;
    }

    /**
     * Import/module references such as:
     *
     * 1:I["...",[],"default"]
     *
     * are not profile data and don't need to be resolved.
     */
    if (payload.startsWith("I[")) {
      continue;
    }

    try {
      records.set(id, JSON.parse(payload));
    } catch {
      /**
       * Some Flight records aren't plain JSON.
       *
       * Keep the raw payload because other records may
       * still reference it.
       */
      records.set(id, payload);
    }
  }

  return records;
}

/**
 * Resolves references such as:
 *
 * $L6
 * $Le
 * $L11
 * $L1a
 *
 * It deliberately does NOT attempt to resolve strings such as:
 *
 * $21:props:children:props:...
 *
 * Those are React Flight path references and are not necessary
 * for our profile-data extraction.
 */
export function resolveFlightValue(
  value: unknown,
  records: FlightRecordMap,
  resolving = new Set<string>()
): unknown {
  if (typeof value === "string") {
    const referenceMatch = value.match(/^\$L([0-9a-f]+)$/i);

    if (!referenceMatch) {
      return value;
    }

    const recordId = referenceMatch[1].toLowerCase();

    if (resolving.has(recordId)) {
      return value;
    }

    const referenced = records.get(recordId);

    if (referenced === undefined) {
      return value;
    }

    const nextResolving = new Set(resolving);

    nextResolving.add(recordId);

    return resolveFlightValue(referenced, records, nextResolving);
  }

  if (Array.isArray(value)) {
    return value.map(item =>
      resolveFlightValue(item, records, new Set(resolving))
    );
  }

  if (value && typeof value === "object") {
    const resolved: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      resolved[key] = resolveFlightValue(child, records, new Set(resolving));
    }

    return resolved;
  }

  return value;
}

export function resolveFlightRoot(rsc: string): unknown {
  const records = parseFlightRecords(rsc);

  const root = records.get("0");

  if (root === undefined) {
    throw new Error("LinkedIn Flight response did not contain root record 0");
  }

  return resolveFlightValue(root, records);
}

export function walkFlightTree(
  value: unknown,
  visitor: (value: unknown) => void
): void {
  visitor(value);

  if (Array.isArray(value)) {
    for (const child of value) {
      walkFlightTree(child, visitor);
    }

    return;
  }

  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      walkFlightTree(child, visitor);
    }
  }
}
