import "dotenv/config";

const LINKEDIN_BASE_URL = "https://www.linkedin.com";

export interface LinkedInRequestOptions {
  url: string;
  body: unknown;
}

function buildHeaders(): Record<string, string> {
  const cookie = process.env.LINKEDIN_COOKIE;
  const csrfToken = process.env.LINKEDIN_CSRF_TOKEN;

  if (!cookie) {
    throw new Error("LINKEDIN_COOKIE is missing from environment");
  }

  const headers: Record<string, string> = {
    accept: "*/*",
    "content-type": "application/json",
    cookie,

    origin: LINKEDIN_BASE_URL,
    referer: `${LINKEDIN_BASE_URL}/`,

    "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/131 Safari/537.36",
  };

  if (csrfToken) {
    headers["csrf-token"] = csrfToken;
  }

  if (process.env.LINKEDIN_PAGE_INSTANCE) {
    headers["x-li-page-instance"] = process.env.LINKEDIN_PAGE_INSTANCE;
  }

  if (process.env.LINKEDIN_APPLICATION_INSTANCE) {
    headers["x-li-application-instance"] =
      process.env.LINKEDIN_APPLICATION_INSTANCE;
  }

  if (process.env.LINKEDIN_APPLICATION_VERSION) {
    headers["x-li-application-version"] =
      process.env.LINKEDIN_APPLICATION_VERSION;
  }

  return headers;
}

export async function linkedinPost({
  url,
  body,
}: LinkedInRequestOptions): Promise<string> {
  const response = await fetch(url, {
    method: "POST",

    headers: buildHeaders(),

    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `LinkedIn request failed: ${response.status} ${response.statusText}\n${responseText.slice(
        0,
        500
      )}`
    );
  }

  return responseText;
}
