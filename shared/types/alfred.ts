import type { ActualBillOccurrence } from "./actual.ts";
import type { NormalizedCalendarEvent } from "./calendar.ts";
import type { DeadlineOccurrence } from "./tasks.ts";
import type { TransactionRecord, TransactionSummaryBucket, TransactionGroupBy } from "./transactions.ts";

export type AlfredProvider = "anthropic" | "openai";
export type AlfredModelId = string;

export type AlfredToolName =
  | "search_email"
  | "get_email_body"
  | "get_calendar_events"
  | "get_deadlines"
  | "get_upcoming_bills"
  | "search_transactions"
  | "summarize_transactions"
  | "show_items"
  | "group_items";

export type AlfredItemKind = "email" | "event" | "deadline" | "bill" | "transaction";

export interface AlfredEmailSender {
  name?: string | null;
  address?: string | null;
}

export interface AlfredEmailContextSource {
  uid: string;
  /** Client-only preview identity; stripped before context preparation. */
  accountId?: string | null;
  subject?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  timestamp?: string | null;
}

export interface AlfredEmailAttachmentRef {
  uid: string;
  /** Client-only preview identity; never included in the model context. */
  accountId?: string | null;
  subject: string;
  sender: AlfredEmailSender & { display: string };
  timestamp: string | null;
  charCount: number;
}

export interface AlfredPreparedEmailContext extends AlfredEmailAttachmentRef {
  contextId: string;
}

export interface AlfredEmailItem extends Record<string, unknown> {
  uid: string;
  subject?: string | null;
  from?: AlfredEmailSender | string | null;
  email_date?: string | null;
  email_date_utc?: string | null;
  read?: boolean;
  body_snippet?: string | null;
  body_excerpt?: string | null;
  account?: { id?: string | null; email?: string | null; label?: string | null } | null;
  metadata?: {
    lane?: string | null;
    category?: string | null;
    urgency?: string | null;
    deadline_at?: string | null;
    bill_candidate?: unknown;
    handled?: boolean;
  } | null;
}

export interface AlfredItemMap {
  email: AlfredEmailItem;
  event: NormalizedCalendarEvent;
  deadline: DeadlineOccurrence;
  bill: ActualBillOccurrence;
  transaction: TransactionRecord;
}

export type AlfredItem = AlfredItemMap[AlfredItemKind] & Record<string, unknown>;

export interface AlfredRunStartEvent {
  type: "run_start";
  conversation_id: string;
  provider: AlfredProvider;
  model: AlfredModelId;
}

export interface AlfredTextDeltaEvent {
  type: "text_delta";
  text: string;
}

export interface AlfredToolStartEvent {
  type: "tool_start";
  tool_id: string;
  name: AlfredToolName;
}

export interface AlfredToolResultEvent {
  type: "tool_result";
  tool_id: string;
  name: AlfredToolName;
  ok: boolean;
  summary: string;
}

export type AlfredRowsEvent = {
  [K in AlfredItemKind]: {
    type: "rows";
    kind: K;
    items: AlfredItemMap[K][];
  }
}[AlfredItemKind];

export interface AlfredSummaryEvent {
  type: "summary";
  total: number;
  period: { start: string; end: string };
  group_by: TransactionGroupBy;
  buckets: TransactionSummaryBucket[];
}

export interface AlfredBreakdownBucket<K extends AlfredItemKind = AlfredItemKind> {
  label: string;
  count: number;
  items: AlfredItemMap[K][];
}

export type AlfredBreakdownEvent = {
  [K in AlfredItemKind]: {
    type: "breakdown";
    kind: K;
    title: string;
    caption?: string;
    total: number;
    buckets: AlfredBreakdownBucket<K>[];
  }
}[AlfredItemKind];

export interface AlfredRunEndEvent {
  type: "run_end";
  stop_reason: string;
}

export interface AlfredRunErrorEvent {
  type: "run_error";
  message: string;
  code?: "context_window_exceeded" | string;
}

export type AlfredRunEvent =
  | AlfredRunStartEvent
  | AlfredTextDeltaEvent
  | AlfredToolStartEvent
  | AlfredToolResultEvent
  | AlfredRowsEvent
  | AlfredSummaryEvent
  | AlfredBreakdownEvent
  | AlfredRunEndEvent
  | AlfredRunErrorEvent;

export interface AlfredStreamOptions {
  message: string;
  conversationId?: string | null;
  emailContextId?: string | null;
  signal?: AbortSignal;
  onEvent: (event: AlfredRunEvent) => void;
}

export interface AlfredConversationDeleteResponse {
  ok: true;
}

export type AlfredDateRangeInput = { start?: unknown; end?: unknown; query?: unknown };
export type AlfredTransactionInput = AlfredDateRangeInput & {
  payee?: unknown;
  category?: unknown;
  account?: unknown;
  notes?: unknown;
  direction?: unknown;
  min_amount?: unknown;
  max_amount?: unknown;
};

export interface AlfredToolInputMap {
  search_email: {
    query?: unknown;
    lexical_queries?: unknown;
    after?: unknown;
    before?: unknown;
    read_filter?: unknown;
    limit?: unknown;
    offset?: unknown;
  };
  get_email_body: { uid?: unknown };
  get_calendar_events: AlfredDateRangeInput;
  get_deadlines: AlfredDateRangeInput;
  get_upcoming_bills: AlfredDateRangeInput;
  search_transactions: AlfredTransactionInput & { limit?: unknown };
  summarize_transactions: AlfredTransactionInput & { group_by?: unknown };
  show_items: { kind?: unknown; ids?: unknown };
  group_items: { kind?: unknown; title?: unknown; caption?: unknown; groups?: unknown };
}

export interface AlfredToolResultBase extends Record<string, unknown> {
  error?: string;
}

export interface AlfredToolResultMap {
  search_email: AlfredToolResultBase & { total?: number; results?: Record<string, unknown>[] };
  get_email_body: AlfredToolResultBase & { uid?: string; body?: string; subject?: string; from?: string };
  get_calendar_events: AlfredToolResultBase & { total?: number; events?: Record<string, unknown>[] };
  get_deadlines: AlfredToolResultBase & { total?: number; open?: number; deadlines?: Record<string, unknown>[] };
  get_upcoming_bills: AlfredToolResultBase & { total?: number; bills?: Record<string, unknown>[] };
  search_transactions: AlfredToolResultBase & { total?: number; transactions?: Record<string, unknown>[] };
  summarize_transactions: AlfredToolResultBase & { total?: number; direction?: string; buckets?: TransactionSummaryBucket[] };
  show_items: AlfredToolResultBase & { shown?: number };
  group_items: AlfredToolResultBase & { shown?: number };
}

export interface AlfredUsageModelSummary {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AlfredUsageToolSummary {
  name: string;
  calls: number;
  errors: number;
  errorRate: number;
  avgDurationMs: number;
}

export interface AlfredUsageWindow {
  windowDays: number | null;
  windowLabel: string;
  queries: number;
  turns: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedSavingsUsd: number;
  cacheHitRate: number;
}

export interface AlfredUsageStats extends AlfredUsageWindow {
  generatedAt: string;
  lastUsedAt: string | null;
  byModel: Record<string, AlfredUsageModelSummary | undefined>;
  tools: {
    totalCalls: number;
    distinctTools: number;
    byTool: AlfredUsageToolSummary[];
  };
  estimatedSavingsUsd: number;
  comparisonWindows: { monthToDate: AlfredUsageWindow };
}
