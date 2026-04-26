export const PROJECT_CONTEXT_MAINTAINER_AGENT = {
  id: "project-context-maintainer",
  visibility: "internal",
  userSelectable: false,
  delegateOnly: true,
  purpose: "Search the private Project Context workspace without exposing scaffold structure to the main coding agent. Prepare and update are automatic runtime actions."
} as const;
