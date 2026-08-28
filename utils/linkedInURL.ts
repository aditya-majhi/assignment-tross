export function extractVanityName(profileUrl: string): string {
  let url: URL;

  try {
    url = new URL(profileUrl);
  } catch {
    throw new Error("Invalid LinkedIn profile URL");
  }

  if (url.hostname !== "linkedin.com" && url.hostname !== "www.linkedin.com") {
    throw new Error("URL must be a LinkedIn URL");
  }

  const match = url.pathname.match(/^\/in\/([^/?#]+)/);

  if (!match) {
    throw new Error(
      "Expected LinkedIn profile URL like https://www.linkedin.com/in/username/"
    );
  }

  return decodeURIComponent(match[1]);
}
