/**
 * Simple parser to extract Thinking, Actions, and Context Updates
 * from the serialized agent output.
 */
export const parseAgentOutput = (rawOutput: string) => {
  return {
    raw: rawOutput,
    thinking: extractSection(rawOutput, 'THINKING'),
    actions: extractSection(rawOutput, 'ACTIONS'),
    contextUpdates: extractSection(rawOutput, 'CONTEXT_UPDATES'),
    status: extractSection(rawOutput, 'STATUS') || 'UNKNOWN',
  };
};

function extractSection(text: string, sectionName: string): string {
  const regex = new RegExp(`${sectionName}:?\\s*([\\s\\S]*?)(?=\\n\\d+\\.\\s|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}
