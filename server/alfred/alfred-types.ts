import type { CalendarAccount, NormalizedCalendarEvent } from "../../shared/types/calendar.ts";
import type { EmailBody } from "../../shared/types/email.ts";
import type { DeadlineRangeResult } from "../../shared/types/tasks.ts";
import type { ActualBillOccurrence } from "../../shared/types/actual.ts";
import type { TransactionQueryResult, TransactionSummaryResult } from "../../shared/types/transactions.ts";
import type {
  AlfredItem,
  AlfredItemKind,
  AlfredModelId,
  AlfredRunEvent,
} from "../../shared/types/alfred.ts";

export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: { type: "ephemeral" };
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: true;
  cache_control?: { type: "ephemeral" };
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AlfredConversation {
  id: string;
  messages: AnthropicMessage[];
  items: Map<string, AlfredItem | Record<string, unknown>>;
  touchedAt: number;
}

export type AlfredEmit = (event: AlfredRunEvent) => void;

export interface AlfredSearchCandidate extends Record<string, unknown> {
  uid: string;
  subject?: string | null;
  from?: string | { name?: string | null; address?: string | null } | null;
  email_date?: string | null;
  email_date_utc?: string | null;
  read?: boolean;
  body_snippet?: string | null;
  body_excerpt?: string | null;
  metadata?: {
    lane?: string | null;
    category?: string | null;
    urgency?: string | null;
    deadline_at?: string | null;
    bill_candidate?: unknown;
    handled?: boolean;
  } | null;
  account?: { email?: string | null; label?: string | null } | null;
}

export interface AlfredSearchResult {
  candidates?: AlfredSearchCandidate[];
  total?: number;
  offset?: number;
  has_more?: boolean;
  capped?: boolean;
  mode?: string;
}

export interface AlfredUserConfig {
  accounts?: CalendarAccount[];
}

export interface AlfredDependencies {
  retrieve(userId: string, input: Record<string, unknown>): Promise<AlfredSearchResult>;
  getEmailBody(userId: string, uid: string): Promise<EmailBody | null>;
  htmlToPlainText(html: string): string;
  fetchCalendar(accounts: CalendarAccount[], range: Record<string, unknown>): Promise<NormalizedCalendarEvent[]>;
  pacificDayBoundaries(date: Date): { dayStart: Date; dayEnd: Date };
  loadUserConfig(userId: string): Promise<AlfredUserConfig>;
  readCalendarDeadlineRange(userId: string, range: { start: string; end: string }): Promise<DeadlineRangeResult>;
  readBillsMirrorRange(userId: string, range: { start: string; end: string }): Promise<{
    schedules?: ActualBillOccurrence[];
    syncHealth?: { state?: string };
  }>;
  queryTransactions(userId: string, filters: Record<string, unknown>): Promise<TransactionQueryResult>;
  summarizeTransactions(userId: string, filters: Record<string, unknown>): Promise<TransactionSummaryResult>;
}

export interface AlfredUsageInput {
  eventType: "alfred_run_turn" | "alfred_tool_call";
  model: string;
  usage: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type AlfredUsageRecorder = (userId: string, input: AlfredUsageInput) => Promise<unknown>;

export interface AlfredFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  body?: AsyncIterable<Uint8Array | string> | null;
}

export type AlfredFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<AlfredFetchResponse>;

export interface RunAlfredOptions {
  userId: string;
  conversation: AlfredConversation;
  message: string;
  model: AlfredModelId;
  emit: AlfredEmit;
  signal?: AbortSignal | null;
  fetchImpl?: AlfredFetch;
  apiKey?: string;
  deps: AlfredDependencies;
  recordUsage?: AlfredUsageRecorder;
  now?: () => Date;
}

export interface AlfredToolContext {
  userId: string;
  conversation: AlfredConversation;
  deps: AlfredDependencies;
  emit: AlfredEmit;
}

export interface AlfredCachedItems<K extends AlfredItemKind = AlfredItemKind> {
  found: AlfredItem[];
  missing: string[];
}

export interface AnthropicTurn {
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  stopReason: string | null;
  usage: Record<string, unknown>;
  model: string | null;
}

export function errorMessage(error: unknown, fallback = "tool failed"): string {
  return error instanceof Error ? error.message : fallback;
}
