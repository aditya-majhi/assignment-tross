import { normalizeRscResponse, resolveFlightRoot, walkFlightTree } from "./rsc";
import { linkedinPost } from "./client";

const EXPERIENCE_COMPONENT =
  "com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly";

export type Experience = {
  id: string | null;
  title: string | null;
  company: string | null;
  companyUrl: string | null;
  employmentType: string | null;

  startDate: string | null;
  endDate: string | null;

  duration: string | null;

  location: string | null;
  locationType: string | null;

  description: string | null;

  skills: string[];

  rawAssociationTitle?: string | null;
};

type PositionAssociation = {
  id: string;
  title: string | null;
};

type InitialItem = {
  key?: unknown;
  item?: unknown;
  semanticId?: unknown;
};

/**
 * Call this after linkedinPost().
 *
 * Raw LinkedIn response can be either:
 *
 * - normal RSC text
 * - base64 encoded RSC
 */
export function prepareExperienceResponse(rawResponse: string): string {
  return normalizeRscResponse(rawResponse);
}

export function parseExperiences(rsc: string): Experience[] {
  const root = resolveFlightRoot(rsc);

  const collections = findInitialItemCollections(root);

  const results: Experience[] = [];

  const seen = new Set<string>();

  for (const collection of collections) {
    for (const entry of collection) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const item = entry as InitialItem;

      if (item.item === undefined) {
        continue;
      }

      const parsed = parseExperienceItem(item.item);

      for (const experience of parsed) {
        const dedupeKey =
          experience.id ??
          [
            experience.title,
            experience.company,
            experience.startDate,
            experience.endDate,
          ].join("|");

        if (!dedupeKey || seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);

        results.push(experience);
      }
    }
  }

  /**
   * Fallback:
   *
   * If LinkedIn changes the collection wrapper but the position
   * metadata is still somewhere in the resolved tree, retrieve it.
   */
  if (!results.length) {
    const associations = findPositionAssociations(root);

    for (const association of associations) {
      if (seen.has(association.id)) {
        continue;
      }

      seen.add(association.id);

      const split = splitAssociationTitle(association.title);

      results.push({
        id: association.id,
        title: split.title,
        company: split.company,
        companyUrl: null,
        employmentType: null,
        startDate: null,
        endDate: null,
        duration: null,
        location: null,
        locationType: null,
        description: null,
        skills: [],
        rawAssociationTitle: association.title,
      });
    }
  }

  return results;
}

function parseExperienceItem(item: unknown): Experience[] {
  const associations = findPositionAssociations(item);

  /**
   * Companies with multiple roles can contain several
   * position associations inside one LinkedIn collection item.
   */
  if (!associations.length) {
    return [];
  }

  const text = collectVisibleText(item);

  const links = collectUrls(item);

  const experiences: Experience[] = [];

  for (const association of associations) {
    const associationParts = splitAssociationTitle(association.title);

    const fields = inferExperienceFields(
      text,
      associationParts.title,
      associationParts.company
    );

    experiences.push({
      id: association.id,

      title: fields.title ?? associationParts.title,

      company: fields.company ?? associationParts.company,

      companyUrl: findCompanyUrl(
        links,
        fields.company ?? associationParts.company
      ),

      employmentType: fields.employmentType,

      startDate: fields.startDate,

      endDate: fields.endDate,

      duration: fields.duration,

      location: fields.location,

      locationType: fields.locationType,

      description: fields.description,

      skills: fields.skills,

      rawAssociationTitle: association.title,
    });
  }

  return experiences;
}

function findInitialItemCollections(root: unknown): InitialItem[][] {
  const collections: InitialItem[][] = [];

  walkFlightTree(root, value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    const obj = value as Record<string, unknown>;

    if (Array.isArray(obj.initialItems)) {
      collections.push(obj.initialItems as InitialItem[]);
    }
  });

  return collections;
}

function findPositionAssociations(root: unknown): PositionAssociation[] {
  const results: PositionAssociation[] = [];

  const seen = new Set<string>();

  walkFlightTree(root, value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    const obj = value as Record<string, unknown>;

    if (
      obj.associationType === "position" &&
      typeof obj.associationId === "string"
    ) {
      const id = obj.associationId;

      if (seen.has(id)) {
        return;
      }

      seen.add(id);

      results.push({
        id,

        title:
          typeof obj.associationTitle === "string"
            ? cleanText(obj.associationTitle)
            : null,
      });
    }

    /**
     * Some LinkedIn actions expose positionId instead of
     * associationId.
     */
    if (typeof obj.positionId === "string") {
      const id = obj.positionId;

      if (seen.has(id)) {
        return;
      }

      const title = typeof obj.title === "string" ? cleanText(obj.title) : null;

      seen.add(id);

      results.push({
        id,
        title,
      });
    }
  });

  return results;
}

function collectVisibleText(root: unknown): string[] {
  const result: string[] = [];

  walkFlightTree(root, value => {
    if (typeof value !== "string") {
      return;
    }

    const text = cleanText(value);

    if (!text) {
      return;
    }

    if (shouldIgnoreText(text)) {
      return;
    }

    result.push(text);
  });

  return unique(result);
}

function collectUrls(root: unknown): string[] {
  const urls: string[] = [];

  walkFlightTree(root, value => {
    if (typeof value !== "string") {
      return;
    }

    if (
      value.startsWith("https://") ||
      value.startsWith("http://") ||
      value.startsWith("/")
    ) {
      urls.push(value);
    }
  });

  return unique(urls);
}

function inferExperienceFields(
  rawText: string[],
  knownTitle: string | null,
  knownCompany: string | null
): {
  title: string | null;
  company: string | null;
  employmentType: string | null;
  startDate: string | null;
  endDate: string | null;
  duration: string | null;
  location: string | null;
  locationType: string | null;
  description: string | null;
  skills: string[];
} {
  const text = rawText.map(cleanText).filter(Boolean);

  const dateLine = text.find(isDateRange) ?? null;

  const locationLine = text.find(isLocationLine) ?? null;

  const employmentLine = text.find(containsEmploymentType) ?? null;

  const title = knownTitle ?? findLikelyTitle(text);

  let company = knownCompany;

  let employmentType: string | null = null;

  /**
   * Common LinkedIn format:
   *
   * Company name · Full-time
   */
  if (employmentLine) {
    const parts = splitDotSeparated(employmentLine);

    if (parts.length >= 2 && containsEmploymentType(parts[parts.length - 1])) {
      employmentType = parts[parts.length - 1];

      if (!company) {
        company = parts.slice(0, -1).join(" · ");
      }
    } else if (containsEmploymentType(employmentLine)) {
      employmentType = findEmploymentType(employmentLine);
    }
  }

  const date = parseDateLine(dateLine);

  const location = parseLocationLine(locationLine);

  const skills = extractSkills(text);

  const description = extractDescription(text, {
    title,
    company,
    employmentType,
    dateLine,
    locationLine,
    skills,
  });

  return {
    title,
    company,
    employmentType,

    startDate: date.startDate,

    endDate: date.endDate,

    duration: date.duration,

    location: location.location,

    locationType: location.locationType,

    description,

    skills,
  };
}

function splitAssociationTitle(value: string | null): {
  title: string | null;
  company: string | null;
} {
  if (!value) {
    return {
      title: null,
      company: null,
    };
  }

  /**
   * LinkedIn exposes values like:
   *
   * "Frontend Developer at WeAnalyz"
   */
  const match = value.match(/^(.+?)\s+at\s+(.+)$/i);

  if (!match) {
    return {
      title: value,
      company: null,
    };
  }

  return {
    title: cleanText(match[1]),

    company: cleanText(match[2]),
  };
}

function parseDateLine(value: string | null): {
  startDate: string | null;
  endDate: string | null;
  duration: string | null;
} {
  if (!value) {
    return {
      startDate: null,
      endDate: null,
      duration: null,
    };
  }

  const sections = splitDotSeparated(value);

  const range = sections[0] ?? value;

  const duration = sections.length > 1 ? sections[sections.length - 1] : null;

  const parts = range
    .split(/\s*[-–—]\s*/)
    .map(cleanText)
    .filter(Boolean);

  return {
    startDate: parts[0] ?? null,

    endDate: parts[1] ?? null,

    duration: duration && duration !== range ? duration : null,
  };
}

function parseLocationLine(value: string | null): {
  location: string | null;
  locationType: string | null;
} {
  if (!value) {
    return {
      location: null,
      locationType: null,
    };
  }

  const parts = splitDotSeparated(value);

  if (parts.length >= 2) {
    const final = parts[parts.length - 1];

    if (/^(remote|hybrid|on-site|onsite)$/i.test(final)) {
      return {
        location: parts.slice(0, -1).join(" · "),

        locationType: final,
      };
    }
  }

  if (/^(remote|hybrid|on-site|onsite)$/i.test(value)) {
    return {
      location: null,
      locationType: value,
    };
  }

  return {
    location: value,
    locationType: null,
  };
}

function extractSkills(text: string[]): string[] {
  const skills: string[] = [];

  for (const value of text) {
    if (!/\bskills?\b/i.test(value)) {
      continue;
    }

    /**
     * Example observed:
     *
     * JavaScript, Redux.js and +3 skills
     */
    const cleaned = value
      .replace(/\s+and\s+\+\d+\s+skills?$/i, "")
      .replace(/\+\d+\s+skills?$/i, "")
      .trim();

    if (!cleaned || /^skills?$/i.test(cleaned)) {
      continue;
    }

    const parts = cleaned
      .split(/\s*,\s*|\s+and\s+/i)
      .map(cleanText)
      .filter(Boolean);

    skills.push(...parts);
  }

  return unique(skills);
}

function extractDescription(
  text: string[],
  known: {
    title: string | null;
    company: string | null;
    employmentType: string | null;
    dateLine: string | null;
    locationLine: string | null;
    skills: string[];
  }
): string | null {
  const excluded = new Set(
    [
      known.title,
      known.company,
      known.employmentType,
      known.dateLine,
      known.locationLine,
      ...known.skills,
    ]
      .filter(Boolean)
      .map(value => value!.toLowerCase())
  );

  const descriptionParts = text.filter(value => {
    const lower = value.toLowerCase();

    if (excluded.has(lower)) {
      return false;
    }

    if (containsEmploymentType(value)) {
      return false;
    }

    if (isDateRange(value)) {
      return false;
    }

    if (isLocationLine(value)) {
      return false;
    }

    if (/\bskills?\b/i.test(value)) {
      return false;
    }

    if (/^skills for /i.test(value)) {
      return false;
    }

    /**
     * URLs / navigation / media metadata don't belong
     * in the job description.
     */
    if (value.startsWith("/in/") || value.startsWith("http")) {
      return false;
    }

    /**
     * Descriptions are generally sentence-like or longer.
     */
    return value.length >= 35 || /[.!?]$/.test(value);
  });

  if (!descriptionParts.length) {
    return null;
  }

  return unique(descriptionParts).join("\n");
}

function findCompanyUrl(
  urls: string[],
  _company: string | null
): string | null {
  /**
   * Prefer real LinkedIn company links.
   *
   * Ignore overlays and profile-navigation URLs.
   */
  const companyUrl = urls.find(url => /\/company\//i.test(url));

  return companyUrl ?? null;
}

function findLikelyTitle(text: string[]): string | null {
  return text.find(looksLikeJobTitle) ?? null;
}

function looksLikeJobTitle(value: string): boolean {
  return /\b(developer|engineer|designer|manager|analyst|consultant|architect|intern|founder|director|specialist|lead)\b/i.test(
    value
  );
}

function isDateRange(value: string): boolean {
  const month = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";

  const pattern = new RegExp(
    `\\b${month}\\s+\\d{4}\\b[\\s\\S]{0,20}(Present|${month}\\s+\\d{4})`,
    "i"
  );

  return pattern.test(value);
}

function isLocationLine(value: string): boolean {
  if (/(?:^| · )(Remote|Hybrid|On-site|Onsite)$/i.test(value)) {
    return true;
  }

  /**
   * Avoid mistaking long descriptions for locations.
   */
  if (value.length > 100) {
    return false;
  }

  return (
    /\bIndia\b/i.test(value) ||
    /\bCanada\b/i.test(value) ||
    /\bUnited States\b/i.test(value) ||
    /\bUnited Kingdom\b/i.test(value)
  );
}

function containsEmploymentType(value: string): boolean {
  return /\b(full-time|part-time|freelance|contract|internship|self-employed|temporary|apprenticeship|seasonal)\b/i.test(
    value
  );
}

function findEmploymentType(value: string): string | null {
  const match = value.match(
    /\b(full-time|part-time|freelance|contract|internship|self-employed|temporary|apprenticeship|seasonal)\b/i
  );

  return match ? match[1] : null;
}

function splitDotSeparated(value: string): string[] {
  return value
    .split(/\s*[·•]\s*/)
    .map(cleanText)
    .filter(Boolean);
}

function shouldIgnoreText(value: string): boolean {
  if (
    value === "$" ||
    value.startsWith("$L") ||
    value.startsWith("$S") ||
    value === "$undefined"
  ) {
    return true;
  }

  const ignored = new Set([
    "Show all",
    "Show more",
    "Show less",
    "more",
    "less",
    "Experience",
    "Media",
    "Collapsed",
    "Expanded",
  ]);

  if (ignored.has(value)) {
    return true;
  }

  if (value.startsWith("proto.") || value.startsWith("com.linkedin.")) {
    return true;
  }

  /**
   * Hashed CSS class strings.
   */
  if (/^[_a-f0-9 ]{20,}$/i.test(value) && value.includes(" ")) {
    return true;
  }

  return false;
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildExperienceUrl(): string {
  const url = new URL(
    "https://www.linkedin.com/flagship-web/rsc-action/actions/component"
  );

  url.searchParams.set("componentId", EXPERIENCE_COMPONENT);

  url.searchParams.set("sduiid", EXPERIENCE_COMPONENT);

  const parentSpanId = process.env.LINKEDIN_EXPERIENCE_PARENT_SPAN_ID;

  if (parentSpanId) {
    url.searchParams.set("parentSpanId", parentSpanId);
  }

  return url.toString();
}

function buildExperiencePayload(vanityName: string, vieweeProfileId: string) {
  return {
    clientArguments: {
      knownTemplateIds: [],

      payload: {
        isSelfView: false,

        profileComponentState: {
          deferredTopCardReloadProfileId: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateDeferredTopCardReloadProfileId${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          lastFeaturedActionRef: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateLastFeaturedActionRef${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          lastPerformedActionRef: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateLastPerformedActionRef${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          loadedSections: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateLoadedProfileSections${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          profileId: vanityName,

          shouldDisplayStickyHeader: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateShouldDisplayStickyHeader${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          shouldDisplayTabAnchors: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateShouldDisplayTabAnchors${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          shouldFetchFromCache: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateFetchFromCache${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          shouldFocusFeaturedOnReappear: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateShouldFocusFeaturedOnReappear${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          shouldFocusOnReappear: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateShouldFocusOnReappear${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          shouldHideProfileCards: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateShouldHideProfileCards${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          shouldRefreshLanguageDetailScreen: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateShouldRefreshLanguageDetailScreen${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          shouldRefreshScreenOnReappear: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateShouldRefreshScreenOnReappear${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },

          shouldReloadTopCardOnReappear: {
            type: "com.linkedin.sdui.components.core.BindingImpl",
            value: {
              key: `ProfileComponentStateShouldReloadTopCardOnReappear${vanityName}ProfileComponentState`,
              namespace: "MemoryNamespace",
            },
          },
        },

        replaceableSectionArgs: {
          hideCardsForGoldenGate: false,
          isSelfView: false,
          isSelfViewResolved: false,
          shouldSetupReplaceableComponent: true,
          vanityName,
        },

        vanityName,
        vieweeProfileId,
      },

      requestMetadata: {
        $type: "proto.sdui.common.RequestMetadata",
      },

      screenId: "com.linkedin.sdui.flagshipnav.profile.Profile",

      states: [],
    },
  };
}

export async function fetchExperienceRsc(
  vanityName: string,
  vieweeProfileId: string
): Promise<string> {
  const url = buildExperienceUrl();

  const body = buildExperiencePayload(vanityName, vieweeProfileId);

  const raw = await linkedinPost({
    url,
    body,
  });

  /**
   * IMPORTANT:
   *
   * Handles BOTH:
   *
   * raw RSC
   * base64 -> RSC
   */
  return normalizeRscResponse(raw);
}
