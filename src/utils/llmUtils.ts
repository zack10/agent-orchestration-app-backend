/**
 * Simple parser to extract Thinking, Actions, and Context Updates
 * from the serialized agent output.
 */
export const parseAgentOutput = (rawOutput: string) => {
  let jsonCandidate = rawOutput.trim().replace(/^```(?:json)?\s*/i, "");
  if (jsonCandidate.endsWith("```")) {
    jsonCandidate = jsonCandidate.slice(0, -3).trimEnd();
  }
  try {
    const value = JSON.parse(jsonCandidate) as Record<string, unknown>;
    const status = value.status === "COMPLETED" ? "COMPLETED" : "FAILED";
    return {
      raw: rawOutput,
      thinking: typeof value.summary === "string" ? value.summary : "",
      actions: typeof value.actions === "string" ? value.actions : "",
      contextUpdates:
        value.contextUpdates && typeof value.contextUpdates === "object"
          ? JSON.stringify(value.contextUpdates)
          : "",
      status,
    };
  } catch {
    // Compatibility with existing section-based provider responses.
  }
  return {
    raw: rawOutput,
    thinking:
      extractSection(rawOutput, "SUMMARY") ||
      extractSection(rawOutput, "THINKING"),
    actions: extractSection(rawOutput, "ACTIONS"),
    contextUpdates: extractSection(rawOutput, "CONTEXT_UPDATES"),
    status:
      extractSection(rawOutput, "STATUS").trim().toUpperCase() === "COMPLETED"
        ? "COMPLETED"
        : "FAILED",
  };
};

function extractSection(text: string, sectionName: string): string {
  const regex = new RegExp(
    String.raw`${sectionName}:?\s*([\s\S]*?)(?=\n\d+\.\s|$)`,
    "i",
  );
  const match = regex.exec(text);
  return match ? match[1].trim() : "";
}
