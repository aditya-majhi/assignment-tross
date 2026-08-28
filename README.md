# LinkedIn Profile API

A reverse-engineered LinkedIn profile API built as part of an engineering hiring challenge.

The API accepts a LinkedIn profile URL and returns structured profile information by directly communicating with LinkedIn's internal endpoints.

> **Important:** This project does not use Playwright, Puppeteer, Selenium, or any browser automation for data extraction. LinkedIn's internal requests were manually inspected and reverse-engineered, and the backend reproduces the required requests directly.

## Current Scope

The current implementation extracts:

- Basic profile information
  - Name
  - Headline
  - Profile image
- Experience
- Internal LinkedIn profile identifier required for subsequent requests

The following sections were investigated and their corresponding LinkedIn internal components were identified, but they are **not currently included in the final API response**:

- About
- Education
- Certifications
- Other below-activity profile sections

The scope was intentionally limited to basic profile information and experience for the current implementation.

---

## API

### `POST /api/profile`

Returns structured information for a LinkedIn profile.

### Request

```json
{
  "profileUrl": "https://www.linkedin.com/in/example-user/"
}
```

### Example Response

```json
{
  "success": true,
  "data": {
    "profileUrl": "https://www.linkedin.com/in/example-user/",
    "name": "Example User",
    "headline": "Software Engineer",
    "location": null,
    "about": null,
    "profileImage": "https://media.licdn.com/...",
    "experience": [
      {
        "title": "Software Engineer",
        "company": "Example Company",
        "employmentType": "Full-time",
        "startDate": "Jan 2025",
        "endDate": "Present",
        "duration": "1 yr 8 mos",
        "location": "India",
        "locationType": "Remote"
      }
    ],
    "education": [],
    "skills": [],
    "certifications": [],
    "languages": []
  }
}
```

The exact fields available depend on what LinkedIn returns for the requested profile.

---

# How It Works

## 1. Extract the LinkedIn Vanity Name

The API first converts a public LinkedIn URL such as:

```text
https://www.linkedin.com/in/example-user/
```

into its public profile identifier:

```text
example-user
```

This `vanityName` is then used when communicating with LinkedIn's internal APIs.

---

## 2. Resolve the Profile

During reverse engineering, LinkedIn was found to use an internal profile identifier in addition to the public vanity name.

It looks similar to:

```text
ACoA...
```

This identifier cannot simply be generated from the vanity name.

To resolve it, the implementation calls the following LinkedIn SDUI component:

```text
POST https://www.linkedin.com/flagship-web/rsc-action/actions/component
```

with:

```text
componentId=
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity
```

and:

```text
sduiid=
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity
```

The request contains the target profile's `vanityName`.

The returned RSC payload contains information that allows us to resolve the internal LinkedIn profile ID.

The same response also contains some basic profile information, including profile loading states such as:

```text
profile_name_loading_state
profile_headline_loading_state
profile_photo_loading_state
```

These are used to extract the basic profile information.

---

## 3. Fetch Experience

After resolving the internal profile ID, a second internal LinkedIn component is requested:

```text
POST https://www.linkedin.com/flagship-web/rsc-action/actions/component
```

with:

```text
componentId=
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly
```

and:

```text
sduiid=
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly
```

The request includes both:

```text
vanityName
vieweeProfileId
```

LinkedIn then returns the profile's Experience section as an RSC/React Flight payload.

The response is parsed and normalized into our own stable JSON representation.

---

# Reverse Engineering Approach

The main goal of the challenge was not to scrape rendered HTML, but to determine how LinkedIn's frontend retrieves profile information.

The reverse-engineering process involved:

1. Opening LinkedIn normally while authenticated.
2. Inspecting network traffic generated while visiting profiles.
3. Filtering requests associated with profile sections.
4. Identifying LinkedIn's `/flagship-web/rsc-action/actions/component` endpoint.
5. Comparing requests across different profiles.
6. Determining which parameters were profile-specific and which were UI/request metadata.
7. Replaying the observed requests directly from Node.js.
8. Parsing LinkedIn's RSC responses.
9. Converting the unstable internal response format into our own stable JSON schema.

No browser is used by the API itself.

The browser was only used during the reverse-engineering phase to inspect network requests.

---

# LinkedIn's RSC / SDUI Architecture

One of the main challenges was that LinkedIn appears to have shifted significant parts of its profile frontend toward an **SDUI + React Server Components architecture**.

Instead of receiving conventional REST JSON such as:

```json
{
  "name": "Example User",
  "experience": []
}
```

the endpoint returns serialized React Flight data similar to:

```text
1:I[...]
3:I[...]
6:["$","$L4",null,{...}]
```

Records can reference other records:

```text
"$L6"
"$L11"
"$25"
```

and sometimes contain path-based references.

This means the response cannot be handled as ordinary JSON.

---

# RSC Normalization

A major part of the implementation is therefore the RSC normalization layer.

The normalization pipeline is roughly:

```text
LinkedIn HTTP Response
        |
        v
Transport Normalization
        |
        v
React Flight Record Parsing
        |
        v
Reference Resolution
        |
        v
Semantic Data Extraction
        |
        v
Stable API Schema
```

## Transport Normalization

During development, captured responses appeared in more than one representation.

Some responses appeared directly as React Flight:

```text
1:I[...]
2:null
6:["$", ...]
```

while another captured response appeared Base64-encoded before containing the same type of Flight payload.

Because of this inconsistency, the implementation includes a deliberately defensive normalization layer.

It:

1. Checks whether the response already looks like React Flight.
2. Validates whether another representation may be Base64.
3. Decodes it when appropriate.
4. Verifies that the decoded value resembles Flight data.
5. Converts both forms into the same canonical RSC string.

This normalization is intentionally defensive because LinkedIn's internal response format is not a public or stable API contract.

---

# React Flight Parsing

After normalization, the response is split into Flight records.

For example:

```text
6:["$","$L4",null,{...}]
```

becomes conceptually:

```text
Record ID: 6
Value: [...]
```

The parser creates a record map:

```text
0 -> root component
1 -> imported component
6 -> profile section
11 -> experience item
...
```

References such as:

```text
$L6
```

can then be resolved against this map.

This allows the application to reconstruct enough of the server-generated component tree to locate the profile information.

The goal is **not to recreate React or render the UI**.

We only resolve enough of the Flight structure to recover the underlying profile data.

---

# Why We Do Not Parse CSS Classes

LinkedIn generates internal CSS classes similar to:

```text
_7c6f6f0b
_9ba38444
b1960d0c
```

These are implementation details and can change frequently.

The parser therefore tries to rely on more meaningful signals where possible, including:

```text
data-sdui-component
componentKey
semanticId
associationId
associationTitle
requestedArguments
viewName
pageKey
profile loading state IDs
```

The extracted information is then mapped into our own schema rather than exposing LinkedIn's internal representation.

---

# Discovered LinkedIn Profile Components

While only basic details and Experience are currently implemented, additional profile components were identified during reverse engineering.

## Basic Profile / Activity

```text
componentId:
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity

sduiid:
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity
```

Currently used for profile resolution and available basic profile information.

---

## Experience

```text
componentId:
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly

sduiid:
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly
```

Currently implemented.

---

## About / Above Activity

The following component was identified:

```text
componentId:
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity

sduiid:
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity
```

Endpoint:

```text
POST /flagship-web/rsc-action/actions/component
```

This component has not yet been integrated into the production extraction pipeline.

---

## Education / Certifications / Below Activity

The following component was identified:

```text
componentId:
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1WithoutExp

sduiid:
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1WithoutExp
```

Endpoint:

```text
POST /flagship-web/rsc-action/actions/component
```

Observed profile sections associated with this portion of the profile include Education and Certifications.

This component has been identified but is not currently parsed by the final API.

---

# Architecture

The implementation is separated into small LinkedIn-specific modules.

```text
src/
├── linkedin/
│   ├── client.ts
│   ├── activity.ts
│   ├── experience.ts
│   ├── rsc.ts
│   └── types.ts
│
├── utils/
│   └── linkedin-url.ts
│
├── scrape-profile.ts
└── server.ts
```

### `client.ts`

Responsible for authenticated HTTP communication with LinkedIn.

### `activity.ts`

Fetches the Activity component, extracts available basic profile information, and resolves the target's internal LinkedIn profile ID.

### `experience.ts`

Requests and parses the Experience component.

### `rsc.ts`

Contains the React Flight normalization, parsing, traversal, and reference-resolution logic.

### `scrape-profile.ts`

Coordinates the complete extraction pipeline and combines the extracted sections into the public API response.

---

# Authentication

LinkedIn's internal endpoints require an authenticated LinkedIn session.

Authentication information is provided through environment variables and is **never committed to the repository**.

Example:

```env
PORT=3000

LINKEDIN_COOKIE=your_session_cookie
LINKEDIN_CSRF_TOKEN=your_csrf_token
```

Create your local environment file:

```bash
cp .env.example .env
```

and provide the required values.

> Never commit LinkedIn cookies, session tokens, CSRF tokens, or other credentials.

The `.env` file is excluded through `.gitignore`.

---

# Installation

Clone the repository:

```bash
git clone <repository-url>
cd <repository-name>
```

Install dependencies:

```bash
npm install
```

Create the environment file:

```bash
cp .env.example .env
```

Add the required LinkedIn session configuration.

Start development mode:

```bash
npm run dev
```

The API will be available at:

```text
http://localhost:3000
```
OR use the production variant at:

```text
https://assignment-tross.onrender.com
```

---

# Example Request

```bash
curl -X POST http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrl": "https://www.linkedin.com/in/example-user/"
  }'
```

---

# Problems Encountered

## 1. LinkedIn Does Not Return Conventional JSON

The biggest technical challenge was discovering that the newer profile requests return React Flight/RSC data instead of a conventional REST response.

A standard:

```ts
await response.json();
```

is therefore not sufficient.

A custom parser and normalization layer were required.

---

## 2. RSC References

Useful data is often spread across multiple Flight records.

For example:

```text
initialContent:"$L6"
```

does not contain the actual content.

Record `6` has to be located and resolved before its contents can be inspected.

Some records then contain further references, creating a graph of data rather than a simple JSON document.

---

## 3. Different Response Representations

During investigation, captured responses were observed in both directly readable Flight form and a Base64-wrapped representation.

This required a defensive transport-normalization step before parsing.

---

## 4. Finding the Correct Profile ID

The public URL contains only the vanity name:

```text
/in/example-user/
```

but the internal LinkedIn API's also expect an internal identifier similar to(vieweeProfileId):

```text
ACoA...
```

This value cannot be safely derived from the vanity name.

The implementation therefore first resolves the target profile through the Activity response and uses the resulting identifier in subsequent requests.

---

## 5. Responses Contain Data About Other People

Activity responses can contain posts, reactions, comments, and other actors.

Simply taking the first profile ID or first name found in the response can therefore return information belonging to someone other than the requested profile.

The extraction logic has to associate profile information with the requested target instead of blindly extracting the first matching value.

---

## 6. Generated and Unstable UI Data

LinkedIn's RSC responses contain large amounts of UI-specific information:

```text
CSS classes
tracking IDs
component IDs
React references
visibility states
navigation actions
analytics metadata
```

Most of this is irrelevant to the API.

The parser attempts to isolate semantic profile information while ignoring presentation and tracking data.

---

## 7. Internal APIs Are Not Stable

These are undocumented internal LinkedIn endpoints.

Component names, request structures, Flight serialization, authentication requirements, and response structures may change without notice.

The implementation therefore intentionally separates:

```text
HTTP transport
RSC normalization
Flight parsing
profile extraction
public response schema
```

so changes to LinkedIn's internal implementation can be isolated as much as possible.

---

# Current Limitations

This project is a reverse-engineering prototype rather than a production LinkedIn integration.

Currently:

- Basic profile details are supported.
- Experience extraction is supported.
- About is not yet included in the final response.
- Education is not yet included in the final response.
- Certifications are not yet included in the final response.
- Skills are not yet included in the final response.
- Languages are not yet included in the final response.
- Some profiles or profile sections may return different SDUI structures.
- LinkedIn authentication/session expiration can cause requests to fail.
- LinkedIn may change its internal endpoints at any time.
- Private or restricted profile information cannot be assumed to be available.
- Experience pagination and unusual/grouped experience layouts may require additional handling.

The additional profile components listed above were identified during investigation and provide a clear path for extending the implementation.

---

# Why This Approach?

An easier implementation would be to launch a browser with Playwright/Puppeteer and scrape the rendered profile DOM.

That was deliberately not used.

The goal was to reverse engineer the actual network layer used by LinkedIn's frontend.

The final flow is therefore:

```text
LinkedIn Profile URL
        |
        v
Extract vanityName
        |
        v
Activity SDUI Request
        |
        +----> Basic Profile Details
        |
        +----> Resolve Internal Profile ID
                    |
                    v
             Experience SDUI Request
                    |
                    v
             RSC Normalization
                    |
                    v
             Flight Parsing
                    |
                    v
             Data Extraction
                    |
                    v
             Stable JSON Response
```

This keeps the implementation browserless while demonstrating the reverse-engineering process behind LinkedIn's current profile architecture.

---

# Future Improvements

The next steps would be to integrate the already identified SDUI components for:

- About
- Education
- Certifications
- Skills
- Languages

The RSC parser can also be extended to support additional React Flight reference patterns and more variations in grouped/paginated profile sections.

---

# Disclaimer

This project was created for an engineering evaluation and demonstrates reverse engineering and data-normalization techniques.

LinkedIn's internal endpoints are undocumented and may change at any time. This project is not affiliated with or endorsed by LinkedIn.

Users are responsible for ensuring that their use of the project complies with applicable laws, LinkedIn's terms, and any relevant data-access requirements.
