import { linkedinPost } from "./client";
import {
  normalizeRscResponse,
  parseFlightRecords,
  resolveFlightValue,
  walkFlightTree,
} from "./rsc";

const ACTIVITY_COMPONENT =
  "com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity";

export type BasicProfile = {
  vieweeProfileId: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  profileImage: string | null;
};

function buildActivityUrl(): string {
  const url = new URL(
    "https://www.linkedin.com/flagship-web/rsc-action/actions/component"
  );

  url.searchParams.set("componentId", ACTIVITY_COMPONENT);

  url.searchParams.set("sduiid", ACTIVITY_COMPONENT);

  return url.toString();
}

function buildActivityPayload(vanityName: string) {
  return {
    clientArguments: {
      knownTemplateIds: [],

      payload: {
        isSelfView: false,
        vanityName,
      },

      requestMetadata: {
        $type: "proto.sdui.common.RequestMetadata",
      },

      screenId: "com.linkedin.sdui.flagshipnav.home.Home",

      states: [],
    },
  };
}

export async function fetchBasicProfile(
  vanityName: string
): Promise<BasicProfile> {
  const raw = await linkedinPost({
    url: buildActivityUrl(),

    body: buildActivityPayload(vanityName),
  });

  const rsc = normalizeRscResponse(raw);

  return parseBasicProfile(rsc, vanityName);
}

function parseBasicProfile(
  rsc: string,
  targetVanityName: string
): BasicProfile {
  const records = parseFlightRecords(rsc);

  const rootRecord = records.get("0");

  const resolvedRoot =
    rootRecord !== undefined ? resolveFlightValue(rootRecord, records) : null;

  /**
   * IMPORTANT:
   *
   * We use two extraction strategies:
   *
   * 1. Structured resolved Flight tree
   * 2. Raw RSC fallback
   *
   * Activity responses can contain references whose useful
   * data sits outside record 0.
   */

  const vieweeProfileId = extractTargetProfileId(
    rsc,
    resolvedRoot,
    targetVanityName
  );

  if (!vieweeProfileId) {
    throw new Error(
      `Could not resolve LinkedIn profile ID for ${targetVanityName}`
    );
  }

  const name = findLoadingStateString(rsc, "profile_name_loading_state");

  const headline = findLoadingStateString(
    rsc,
    "profile_headline_loading_state"
  );

  const profileImage = findProfileImage(rsc);

  return {
    vieweeProfileId,
    name,
    headline,

    /**
     * We have not yet captured a reliable source for these.
     * Do not guess them from unrelated text.
     */
    location: null,
    about: null,

    profileImage,
  };
}

function findLoadingStateString(rsc: string, stateId: string): string | null {
  /**
   * Example:
   *
   * id: "profile_name_loading_state"
   * ...
   * stringValue: "..."
   */

  const escapedState = escapeRegex(stateId);

  const regex = new RegExp(
    `"id":"${escapedState}"[\\s\\S]{0,500}?"stringValue":"((?:\\\\.|[^"\\\\])*)"`,
    "i"
  );

  const match = rsc.match(regex);

  if (!match) {
    return null;
  }

  return decodeJsonString(match[1]);
}

function findProfileImage(rsc: string): string | null {
  /**
   * Restrict the search to profile_photo_loading_state.
   *
   * Otherwise Activity responses contain images from posts,
   * other actors, media etc.
   */

  const stateIndex = rsc.indexOf('"id":"profile_photo_loading_state"');

  if (stateIndex === -1) {
    return null;
  }

  const section = rsc.slice(stateIndex, stateIndex + 10000);

  const rootUrlMatch = section.match(/"rootUrl":"((?:\\.|[^"\\])*)"/);

  if (!rootUrlMatch) {
    return null;
  }

  const rootUrl = decodeJsonString(rootUrlMatch[1]);

  const renditions = [
    ...section.matchAll(
      /"width":(\d+),"height":(\d+),"suffixUrl":"((?:\\.|[^"\\])*)"/g
    ),
  ];

  if (!renditions.length) {
    return rootUrl;
  }

  /**
   * Choose largest rendition.
   */
  const largest = renditions
    .map(match => ({
      width: Number(match[1]),
      height: Number(match[2]),
      suffix: decodeJsonString(match[3]),
    }))
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];

  return `${rootUrl}${largest.suffix}`;
}

function extractTargetProfileId(
  rsc: string,
  resolvedRoot: unknown,
  vanityName: string
): string | null {
  /**
   * First try to find an object where the requested vanityName
   * and an ACoA ID occur together.
   */
  const structured = findTargetIdInTree(resolvedRoot, vanityName);

  if (structured) {
    return structured;
  }

  /**
   * Then inspect raw Flight.
   *
   * Don't simply return the first ACoA ID because Activity
   * responses may contain IDs for multiple people.
   */

  const escapedVanity = escapeRegex(vanityName);

  const patterns = [
    new RegExp(
      `"vanityName":"${escapedVanity}"[\\s\\S]{0,3000}?"(?:vieweeProfileId|prioritizedProfileId|profileId|currentUserNonIterableProfileId)":"(ACoA[^"]+)"`,
      "i"
    ),

    new RegExp(
      `"(?:vieweeProfileId|prioritizedProfileId|profileId)":"(ACoA[^"]+)"[\\s\\S]{0,3000}?"vanityName":"${escapedVanity}"`,
      "i"
    ),

    /**
     * Component keys often contain:
     *
     * activity_currentPillACoA...
     * profile.card.refACoA...
     */
    new RegExp(`(?:ref|Pill)(ACoA[A-Za-z0-9_-]+)`, "i"),
  ];

  for (const pattern of patterns) {
    const match = rsc.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function findTargetIdInTree(root: unknown, vanityName: string): string | null {
  let result: string | null = null;

  if (!root) {
    return null;
  }

  walkFlightTree(root, value => {
    if (result || !value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    const obj = value as Record<string, unknown>;

    if (obj.vanityName !== vanityName) {
      return;
    }

    const candidates = [
      obj.vieweeProfileId,
      obj.profileId,
      obj.prioritizedProfileId,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.startsWith("ACoA")) {
        result = candidate;

        return;
      }
    }
  });

  return result;
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
