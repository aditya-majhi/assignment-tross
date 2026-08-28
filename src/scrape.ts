import { fetchBasicProfile } from "./activity";

import { fetchExperienceRsc, parseExperiences } from "./experience";

export type LinkedInProfile = {
  profileUrl: string;

  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  profileImage: string | null;

  experience: unknown[];

  education: unknown[];
  skills: unknown[];
  certifications: unknown[];
  languages: unknown[];
};

export async function scrapeProfile(
  profileUrl: string
): Promise<LinkedInProfile> {
  const vanityName = extractVanityName(profileUrl);

  /**
   * STEP 1:
   * Resolve basic profile + internal ACoA ID.
   */
  const basic = await fetchBasicProfile(vanityName);

  console.log("Resolved target:", {
    vanityName,
    vieweeProfileId: basic.vieweeProfileId,
    name: basic.name,
  });

  /**
   * STEP 2:
   * Fetch Experience using SAME target.
   */
  const experienceRsc = await fetchExperienceRsc(
    vanityName,
    basic.vieweeProfileId
  );

  /**
   * STEP 3:
   * Parse experience.
   */
  const experience = parseExperiences(experienceRsc);

  /**
   * STEP 4:
   * Combine sections.
   */
  return {
    profileUrl,

    name: basic.name,

    headline: basic.headline,

    location: basic.location,

    about: basic.about,

    profileImage: basic.profileImage,

    experience,

    education: [],
    skills: [],
    certifications: [],
    languages: [],
  };
}

function extractVanityName(profileUrl: string): string {
  let url: URL;

  try {
    url = new URL(profileUrl);
  } catch {
    throw new Error("Invalid LinkedIn profile URL");
  }

  if (!url.hostname.toLowerCase().endsWith("linkedin.com")) {
    throw new Error("URL must be a LinkedIn URL");
  }

  const match = url.pathname.match(/^\/in\/([^/]+)\/?/i);

  if (!match) {
    throw new Error(
      "Expected LinkedIn profile URL in the form https://www.linkedin.com/in/username/"
    );
  }

  return decodeURIComponent(match[1]);
}
