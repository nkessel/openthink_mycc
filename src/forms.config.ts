// Links to the MA Climate Coalition Map Google Forms, used by the + button and "Update this info" links.
//
// After running "MA Climate Coalition Map → Set up sheet + forms" in the Google Sheet, copy the JSON
// from the "For the site" row on its Start Here tab and paste it over FORMS below.
// Until then the + button explains that the forms aren't connected yet.

export interface FormLink {
  url: string;
  /** "entry.N" ids that let the site pre-fill a question. */
  orgEntry?: string;
  hostOrgEntry?: string;
  coalitionEntry?: string;
}

export const FORMS: Record<"org" | "event" | "project" | "feedback", FormLink> = {
  org: {
    url: "https://docs.google.com/forms/d/e/1FAIpQLSeQ4MOk9YHT7XX9UTaOEpQrofLU-uqyXVOuu9yEZzGrHzvGpw/viewform",
    orgEntry: "entry.1787507842",
  },
  event: {
    url: "https://docs.google.com/forms/d/e/1FAIpQLSe6jLOWOLU0sZdsiqMcfABsQpSRKyXWocWi4nj_ZRDVtNfxUQ/viewform",
    hostOrgEntry: "entry.250607576",
    coalitionEntry: "entry.1780232957",
  },
  project: {
    url: "https://docs.google.com/forms/d/e/1FAIpQLSe4CpR61Iklqh4U24rcEtqs-0XyxkaMYd2jcMmymHGuFRqM2g/viewform",
    hostOrgEntry: "entry.207544512",
    coalitionEntry: "entry.13985344",
  },
  feedback: {
    url: "https://docs.google.com/forms/d/e/1FAIpQLScwazw1P9rbQT4KAoUn0DSuI6B9Lpdx-kcrZXdZV45-HlAVKw/viewform",
  },
};
