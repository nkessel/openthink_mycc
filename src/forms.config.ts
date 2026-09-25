// Links to the Openthink Google Forms, used by the + button and "Update this info" links.
//
// After running "Openthink → Set up sheet + forms" in the Google Sheet, copy the JSON
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
  org: { url: "" },
  event: { url: "" },
  project: { url: "" },
  feedback: { url: "" },
};
