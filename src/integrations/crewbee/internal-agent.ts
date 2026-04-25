export const PROJECT_CONTEXT_MAINTAINER_AGENT = {
  id: "project-context-maintainer",
  visibility: "internal",
  userSelectable: false,
  delegateOnly: true,
  purpose: "Prepare, search, and finalize .crewbee project context without exposing scaffold structure to the main coding agent."
} as const;
