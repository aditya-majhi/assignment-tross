export interface Experience {
  id?: string | null;

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
}

export interface BasicProfile {
  vanityName: string;
  vieweeProfileId: string;

  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  profileImage: string | null;
}

export interface LinkedInProfile {
  profileUrl: string;

  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  profileImage: string | null;

  experience: Experience[];

  education: unknown[];
  skills: string[];
  certifications: unknown[];
  languages: string[];
}
