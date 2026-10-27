import { ChatMessage, ToolCall, ToolDefinition, ToolRequest, ToolTurn } from "../llm/types";
import { ToolOutcome } from "../sandbox/tools";

/**
 * The act → observe → decide loop: the model picks tools, sees their
 * results and decides the next step, until it calls `finish` or a budget
 * runs out. Model, tools and events are passed in, so the loop itself has
 * no I/O and can be tested with a scripted model.
 */

export interface AgentLoopBudget {
  maxSteps: number;
  /** Input + output tokens this loop may spend. */
  maxTokens: number;
  /** Epoch milliseconds after which no new model call starts. */
  deadline: number;
}

export type AgentStopReason =
  | "done"
  | "blocked"
  | "max_steps"
  | "max_tokens"
  | "timeout"
  | "no_finish";

export interface AgentStep {
  step: number;
  text: string;
  toolCalls: Array<{ call: ToolCall; outcome: ToolOutcome }>;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AgentLoopResult {
  stopReason: AgentStopReason;
  /** The agent's summary for done/blocked; what ran out otherwise. */
  summary: string;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AgentLoopDeps {
  generate: (request: ToolRequest) => Promise<ToolTurn>;
  runTool: (call: ToolCall) => Promise<ToolOutcome>;
  onStep?: (step: AgentStep) => Promise<void>;
  now?: () => number;
}

// Replies without a tool call that are answered with a reminder before the
// loop gives up (models sometimes describe the fix instead of making it).
const MAX_NUDGES = 2;
const NUDGE =
  "Continue by calling a tool. When the change is complete, or the ticket cannot or should not be done, call finish.";

// Once this share of the step or token budget is used, the agent is told
// once, so a finished change is not lost to a budget stop.
const BUDGET_WARNING_SHARE = 0.8;
const budgetWarning = (used: string) =>
  `[Budget: ${used}. If the change is complete and its checks pass, call finish now; otherwise finish with what you have and say what is left.]`;

// Tool results older than the most recent KEEP_RECENT_RESULTS are shortened
// to a stub; the model can call the tool again if it needs them.
const KEEP_RECENT_RESULTS = 8;
const STUB_THRESHOLD_CHARS = 400;

/**
 * Shortens old tool results so long runs fit the context window. Messages
 * are never removed: every tool call keeps its result, which all providers
 * require, and assistant turns keep their raw content for replay.
 */
export const compactMessages = (
  messages: ChatMessage[],
  keepRecent = KEEP_RECENT_RESULTS,
): ChatMessage[] => {
  let recent = 0;
  const keep = new Set<number>();
  for (let index = messages.length - 1; index >= 0 && recent < keepRecent; index--)
    if (messages[index].role === "tool") {
      keep.add(index);
      recent++;
    }
  return messages.map((message, index) => {
    if (message.role !== "tool" || keep.has(index) || message.content.length <= STUB_THRESHOLD_CHARS)
      return message;
    const firstLine = message.content.split("\n", 1)[0].slice(0, 200);
    return {
      ...message,
      content: `${firstLine}\n[older ${message.name} output removed to save context (${message.content.length} characters); call the tool again if you need it]`,
    };
  });
};

export const runAgentLoop = async (
  input: { system: string; task: string; tools: ToolDefinition[]; budget: AgentLoopBudget },
  deps: AgentLoopDeps,
): Promise<AgentLoopResult> => {
  const now = deps.now ?? Date.now;
  const { budget } = input;
  const messages: ChatMessage[] = [{ role: "user", content: input.task }];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let steps = 0;
  let nudges = 0;
  let warned = false;
  const result = (stopReason: AgentStopReason, summary: string): AgentLoopResult => ({
    stopReason,
    summary,
    steps,
    usage: { ...usage },
  });

  for (;;) {
    // Budgets are checked before each model call, so a call that is
    // started always gets to finish and record its tool results.
    if (steps >= budget.maxSteps)
      return result("max_steps", `Stopped after ${budget.maxSteps} steps without calling finish.`);
    if (usage.inputTokens + usage.outputTokens >= budget.maxTokens)
      return result("max_tokens", `Stopped after using ${usage.inputTokens + usage.outputTokens} of ${budget.maxTokens} tokens.`);
    if (now() >= budget.deadline)
      return result("timeout", "Stopped: the execution's time budget ran out.");

    steps++;
    const turn = await deps.generate({
      system: input.system,
      messages: compactMessages(messages),
      tools: input.tools,
    });
    usage.inputTokens += turn.usage?.inputTokens ?? 0;
    usage.outputTokens += turn.usage?.outputTokens ?? 0;
    messages.push(turn.message);
    const stepUsage = { inputTokens: turn.usage?.inputTokens ?? 0, outputTokens: turn.usage?.outputTokens ?? 0 };

    if (turn.toolCalls.length === 0) {
      await deps.onStep?.({ step: steps, text: turn.text, toolCalls: [], usage: stepUsage });
      if (nudges >= MAX_NUDGES)
        return result("no_finish", "The agent stopped calling tools without calling finish.");
      nudges++;
      messages.push({ role: "user", content: NUDGE });
      continue;
    }

    const ran: AgentStep["toolCalls"] = [];
    let finish: ToolOutcome["finish"];
    for (const call of turn.toolCalls) {
      const outcome = await deps.runTool(call);
      ran.push({ call, outcome });
      if (outcome.finish) {
        // Calls after finish in the same turn are not run.
        finish = outcome.finish;
        break;
      }
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: outcome.output,
        isError: outcome.status !== "COMPLETED",
      });
    }
    await deps.onStep?.({ step: steps, text: turn.text, toolCalls: ran, usage: stepUsage });
    if (finish) return result(finish.status, finish.summary);

    // The warning goes into the last tool result: a separate user message
    // after tool results is not accepted by every provider.
    const tokens = usage.inputTokens + usage.outputTokens;
    if (!warned && (steps >= budget.maxSteps * BUDGET_WARNING_SHARE || tokens >= budget.maxTokens * BUDGET_WARNING_SHARE)) {
      warned = true;
      const last = messages[messages.length - 1];
      if (last.role === "tool")
        last.content += `\n\n${budgetWarning(`${steps} of ${budget.maxSteps} steps and ${tokens} of ${budget.maxTokens} tokens used`)}`;
    }
  }
};
