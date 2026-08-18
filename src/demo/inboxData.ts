import type { SnapshotVerificationCode } from "../../shared/types/snapshots.ts";

const WORK_COLOR = "#89b4fa";
const PERSONAL_COLOR = "#cba6f7";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function atLocalIso(baseDate: Date, hour: number, minute = 0): string {
  const value = new Date(baseDate);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

type DemoSnapshotEmail = ReturnType<typeof snapshotEmail>;
type DemoLaneKey = "queued" | "needs_attention" | "catch_up" | "fyi" | "handled" | "untriaged_read" | "noise";
type DemoLanes = Record<DemoLaneKey, DemoSnapshotEmail[]>;

interface DemoSnapshotEmailInput {
  itemId: number;
  uid: string;
  accountId: string;
  lane: DemoLaneKey;
  subject: string;
  fromName: string;
  fromAddress: string;
  summary: string;
  day: Date;
  read?: boolean;
  category?: string;
  urgency?: string;
  source?: string | null;
  sourceAt?: string | null;
  laneAtSnapshot?: DemoLaneKey | null;
  handledAt?: string | null;
  escalationBadge?: string | null;
  receivedHour?: number | null;
  receivedMinute?: number | null;
  verificationCode?: SnapshotVerificationCode | null;
}

function snapshotEmail({
  itemId,
  uid,
  accountId,
  lane,
  subject,
  fromName,
  fromAddress,
  summary,
  day,
  read = false,
  category = "work",
  urgency = lane === "needs_attention" ? "high" : "normal",
  source = null,
  sourceAt = null,
  laneAtSnapshot = null,
  handledAt = null,
  escalationBadge = null,
  receivedHour = null,
  receivedMinute = null,
  verificationCode = null,
}: DemoSnapshotEmailInput) {
  const numericItemId = Number(itemId) || 0;
  const hour = receivedHour ?? (8 + (numericItemId % 10));
  const minute = receivedMinute ?? ((numericItemId * 7) % 60);
  return {
    id: itemId,
    snapshot_item_id: itemId,
    uid,
    email_id: uid,
    account_id: accountId,
    lane,
    category,
    subject,
    from_name: fromName,
    from_address: fromAddress,
    summary,
    action: lane === "needs_attention" ? "Review" : lane === "queued" ? "Classify" : "Read later",
    date: atLocalIso(day, hour, minute),
    read,
    urgency,
    source,
    source_at: sourceAt,
    lane_at_snapshot: laneAtSnapshot,
    handled_at: handledAt,
    escalation_badge: escalationBadge,
    verification_code: verificationCode,
    _activeSnapshot: true,
  };
}

function makeLaneCounts(lanes: DemoLanes, carryover: DemoSnapshotEmail[]) {
  return {
    queued: lanes.queued.length,
    needs_attention: lanes.needs_attention.length,
    catch_up: lanes.catch_up.length,
    fyi: lanes.fyi.length,
    handled: lanes.handled.length,
    untriaged_read: lanes.untriaged_read.length,
    noise: lanes.noise.length,
    carryover: carryover.length,
  };
}

function flattenSnapshotRows(lanes: DemoLanes, carryover: DemoSnapshotEmail[]): DemoSnapshotEmail[] {
  return [
    ...(carryover || []),
    ...Object.values(lanes || {}).flat(),
  ];
}

const DEMO_ACCOUNTS = {
  "demo-gmail": { account_id: "demo-gmail", label: "Demo Gmail", email: "alex@demo.example", color: WORK_COLOR, icon: "Mail" },
  "demo-icloud": { account_id: "demo-icloud", label: "Demo iCloud", email: "alex.personal@example", color: PERSONAL_COLOR, icon: "Mail" },
};

function makeSnapshotFilters(lanes: DemoLanes, carryover: DemoSnapshotEmail[]) {
  const rows = flattenSnapshotRows(lanes, carryover);
  const accountCounts = new Map();
  const categoryCounts = new Map();

  for (const row of rows) {
    accountCounts.set(row.account_id, (accountCounts.get(row.account_id) || 0) + 1);
    categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1);
  }

  return {
    accounts: Object.values(DEMO_ACCOUNTS).map((account) => ({
      ...account,
      count: accountCounts.get(account.account_id) || 0,
    })),
    categories: [...categoryCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => ({ category, count })),
  };
}

function makeEmailBodies(lanes: DemoLanes, carryover: DemoSnapshotEmail[]) {
  return Object.fromEntries(flattenSnapshotRows(lanes, carryover).map((row) => [
    row.uid,
    {
      uid: row.uid,
      body: `This is a fictional demo email body for "${row.subject}". ${row.summary} The content is representative sample data only.`,
    },
  ]));
}

export function buildDemoInboxSeed(now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = addDays(today, -1);
  const fetchedAt = now.toISOString();

  const lanes = {
    queued: [
      snapshotEmail({
        itemId: 5,
        uid: "demo-email-queued-build",
        accountId: "demo-gmail",
        lane: "queued",
        subject: "CI build queued for demo-mode fixture branch",
        fromName: "GitHub Actions",
        fromAddress: "actions@github.example",
        summary: "A new workflow run is waiting for the demo fixture branch.",
        day: today,
        category: "engineering",
        source: "arrival_grace",
        receivedHour: 14,
        receivedMinute: 8,
      }),
      snapshotEmail({
        itemId: 6,
        uid: "demo-email-queued-security",
        accountId: "demo-gmail",
        lane: "queued",
        subject: "Security review queued: OAuth redirect copy",
        fromName: "Security Bot",
        fromAddress: "security@northstar.example",
        summary: "Security automation is classifying an OAuth redirect wording review.",
        day: today,
        category: "security",
        source: "arrival_grace",
        receivedHour: 14,
        receivedMinute: 22,
      }),
    ],
    needs_attention: [
      snapshotEmail({
        itemId: 1,
        uid: "demo-email-budget",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "Budget approval for the demo rollout",
        fromName: "Morgan Lee",
        fromAddress: "morgan@northstar.example",
        summary: "Morgan needs approval on the fictional demo rollout budget before noon.",
        day: today,
        category: "finance",
      }),
      snapshotEmail({
        itemId: 24,
        uid: "demo-email-verification-code",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "Your Northstar sign-in code",
        fromName: "Northstar Security",
        fromAddress: "security@northstar.example",
        summary: "A fictional sign-in code is ready to copy for the demo walkthrough.",
        day: today,
        category: "security",
        urgency: "low",
        receivedHour: now.getHours(),
        receivedMinute: Math.max(0, now.getMinutes() - 2),
        verificationCode: {
          code: "0A7-KQ2",
          kind: "hyphenated",
          active_until: new Date(now.getTime() + 30 * 60_000).toISOString(),
          label: "Verification code",
        },
      }),
      snapshotEmail({
        itemId: 7,
        uid: "demo-email-prod-alert",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "Prod alert: Gmail watch renewal missed",
        fromName: "PagerDuty",
        fromAddress: "alerts@pagerduty.example",
        summary: "A Gmail watch renewal warning needs acknowledgement before the provider window closes.",
        day: today,
        category: "engineering",
        escalationBadge: "Prod",
        receivedHour: 8,
        receivedMinute: 42,
      }),
      snapshotEmail({
        itemId: 8,
        uid: "demo-email-pr-blocker",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "PR blocker: calendar source retry copy",
        fromName: "Riley Park",
        fromAddress: "riley@northstar.example",
        summary: "Riley left a blocking review on the stale calendar-source retry copy.",
        day: today,
        category: "engineering",
        receivedHour: 10,
        receivedMinute: 12,
      }),
      snapshotEmail({
        itemId: 9,
        uid: "demo-email-product-decision",
        accountId: "demo-gmail",
        lane: "needs_attention",
        subject: "Decision needed: hide provider edit on personal date markers",
        fromName: "Morgan Lee",
        fromAddress: "morgan@northstar.example",
        summary: "Morgan needs a final call on read-only personal date marker behavior.",
        day: today,
        category: "product",
        receivedHour: 11,
        receivedMinute: 4,
      }),
      snapshotEmail({
        itemId: 10,
        uid: "demo-email-recruiter",
        accountId: "demo-icloud",
        lane: "needs_attention",
        subject: "Follow-up: senior frontend/SWE screen",
        fromName: "Jamie Rivera",
        fromAddress: "jamie@talent.example",
        summary: "Jamie asked for availability and a concise dashboard architecture summary.",
        day: today,
        category: "career",
        receivedHour: 12,
        receivedMinute: 18,
      }),
    ],
    catch_up: [
      snapshotEmail({
        itemId: 11,
        uid: "demo-email-catchup-rfc",
        accountId: "demo-gmail",
        lane: "catch_up",
        subject: "Thread: snapshot lifecycle RFC notes",
        fromName: "Architecture Guild",
        fromAddress: "arch@northstar.example",
        summary: "The RFC thread has useful context but no immediate decision request.",
        day: yesterday,
        read: true,
        category: "engineering",
        source: "catch_up",
        laneAtSnapshot: "fyi",
      }),
      snapshotEmail({
        itemId: 12,
        uid: "demo-email-catchup-design",
        accountId: "demo-icloud",
        lane: "catch_up",
        subject: "Design archive: dense dashboard examples",
        fromName: "Avery Chen",
        fromAddress: "avery@studio.example",
        summary: "Avery shared reference screenshots for compact operational dashboards.",
        day: yesterday,
        read: true,
        category: "product",
        source: "catch_up",
        laneAtSnapshot: "fyi",
      }),
    ],
    fyi: [
      snapshotEmail({
        itemId: 2,
        uid: "demo-email-design",
        accountId: "demo-icloud",
        lane: "fyi",
        subject: "Design QA notes",
        fromName: "Avery Chen",
        fromAddress: "avery@studio.example",
        summary: "Avery sent polish notes for the portfolio walkthrough.",
        day: yesterday,
        read: true,
        category: "product",
      }),
      snapshotEmail({
        itemId: 13,
        uid: "demo-email-release-notes",
        accountId: "demo-gmail",
        lane: "fyi",
        subject: "Release notes: dashboard-current refresh patch",
        fromName: "Deploy Bot",
        fromAddress: "deploy@northstar.example",
        summary: "The release candidate includes the dashboard-current refresh patch and focused Vitest coverage.",
        day: today,
        read: true,
        category: "engineering",
      }),
      snapshotEmail({
        itemId: 14,
        uid: "demo-email-docs",
        accountId: "demo-gmail",
        lane: "fyi",
        subject: "Docs update: inbox workflow glossary",
        fromName: "Docs Bot",
        fromAddress: "docs@northstar.example",
        summary: "The inbox workflow glossary now reflects queued, catch-up, handled, and noise lanes.",
        day: yesterday,
        read: true,
        category: "documentation",
      }),
      snapshotEmail({
        itemId: 15,
        uid: "demo-email-calendar-coverage",
        accountId: "demo-gmail",
        lane: "fyi",
        subject: "Calendar sync coverage report",
        fromName: "Sync Monitor",
        fromAddress: "sync@northstar.example",
        summary: "Calendar range coverage is current across events, deadlines, and bill overlays.",
        day: today,
        category: "engineering",
      }),
      snapshotEmail({
        itemId: 16,
        uid: "demo-email-school-alumni",
        accountId: "demo-icloud",
        lane: "fyi",
        subject: "Alumni panel invite: SWE portfolio demos",
        fromName: "CS Alumni Office",
        fromAddress: "alumni@example.edu",
        summary: "A panel invite about turning personal systems into credible SWE portfolio stories.",
        day: yesterday,
        read: true,
        category: "career",
      }),
    ],
    handled: [
      snapshotEmail({
        itemId: 17,
        uid: "demo-email-handled-standup",
        accountId: "demo-gmail",
        lane: "handled",
        subject: "Handled: standup notes posted",
        fromName: "Casey Nguyen",
        fromAddress: "casey@northstar.example",
        summary: "Standup notes were posted and no longer need a response.",
        day: today,
        read: true,
        category: "engineering",
        handledAt: atLocalIso(today, 9, 58),
      }),
      snapshotEmail({
        itemId: 18,
        uid: "demo-email-handled-demo-link",
        accountId: "demo-icloud",
        lane: "handled",
        subject: "Handled: demo link received",
        fromName: "Portfolio Reviewer",
        fromAddress: "reviewer@portfolio.example",
        summary: "The reviewer confirmed the demo link works from a clean browser.",
        day: yesterday,
        read: true,
        category: "career",
        handledAt: atLocalIso(today, 10, 16),
      }),
    ],
    untriaged_read: [
      snapshotEmail({
        itemId: 19,
        uid: "demo-email-read-security",
        accountId: "demo-gmail",
        lane: "untriaged_read",
        subject: "Read during grace: dependency advisory",
        fromName: "Dependency Watch",
        fromAddress: "advisory@security.example",
        summary: "A dependency advisory was read before the snapshot finalized classification.",
        day: today,
        read: true,
        category: "security",
        source: "arrival_grace_read",
      }),
    ],
    noise: [
      snapshotEmail({
        itemId: 3,
        uid: "demo-email-newsletter",
        accountId: "demo-gmail",
        lane: "noise",
        subject: "Weekly SaaS digest",
        fromName: "Digest Bot",
        fromAddress: "digest@example.news",
        summary: "A low-priority newsletter routed away from the main workflow.",
        day: yesterday,
        read: true,
        category: "newsletter",
      }),
      snapshotEmail({
        itemId: 20,
        uid: "demo-email-vendor-webinar",
        accountId: "demo-gmail",
        lane: "noise",
        subject: "Webinar: ten dashboards your team needs",
        fromName: "Vendor Marketing",
        fromAddress: "events@vendor.example",
        summary: "A vendor webinar routed away from the active inbox.",
        day: yesterday,
        read: true,
        category: "marketing",
      }),
      snapshotEmail({
        itemId: 21,
        uid: "demo-email-promo",
        accountId: "demo-icloud",
        lane: "noise",
        subject: "Limited-time workspace template sale",
        fromName: "Template Store",
        fromAddress: "promo@templates.example",
        summary: "A promotional email classified as noise.",
        day: yesterday,
        read: true,
        category: "marketing",
      }),
      snapshotEmail({
        itemId: 22,
        uid: "demo-email-status-green",
        accountId: "demo-gmail",
        lane: "noise",
        subject: "Status page: all systems operational",
        fromName: "Status Bot",
        fromAddress: "status@northstar.example",
        summary: "Routine green status update with no required action.",
        day: today,
        read: true,
        category: "operations",
      }),
    ],
  };
  lanes.needs_attention[2]!.urgency = "normal";
  lanes.needs_attention[3]!.urgency = "normal";
  const carryover = [
    snapshotEmail({
      itemId: 4,
      uid: "demo-email-carryover",
      accountId: "demo-gmail",
      lane: "needs_attention",
      subject: "Carryover: contract language",
      fromName: "Jordan Patel",
      fromAddress: "jordan@counsel.example",
      summary: "A carried-over review item from yesterday.",
      day: yesterday,
      category: "legal",
    }),
    snapshotEmail({
      itemId: 23,
      uid: "demo-email-carryover-runbook",
      accountId: "demo-gmail",
      lane: "needs_attention",
      subject: "Carryover: approve retry runbook diff",
      fromName: "Nina Torres",
      fromAddress: "nina@northstar.example",
      summary: "Nina is waiting on a final approval for the retry runbook update.",
      day: yesterday,
      category: "engineering",
    }),
  ];

  const activeSnapshot = {
    snapshot: {
      id: `demo-snapshot-${dateKey(today)}`,
      date: dateKey(today),
      generated_at: fetchedAt,
    },
    filters: makeSnapshotFilters(lanes, carryover),
    lanes,
    carryover,
    laneCounts: makeLaneCounts(lanes, carryover),
    processing: {
      queued: 0,
      running: 0,
      total: 0,
      active: false,
      email_triage_mode: "auto",
      effective_email_triage_mode: "auto",
    },
    readOnly: false,
  };

  return {
    activeSnapshot,
    accounts: {
      accounts: [
        { id: "demo-gmail", type: "gmail", email: "alex@demo.example", label: "Demo Gmail", color: WORK_COLOR, icon: "Mail" },
        { id: "demo-icloud", type: "icloud", email: "alex.personal@example", label: "Demo iCloud", color: PERSONAL_COLOR, icon: "Mail" },
      ],
    },
    importantSenders: [
      { address: "morgan@northstar.example", name: "Morgan Lee", source: "auto" },
      { address: "alerts@pagerduty.example", name: "PagerDuty", source: "auto" },
      { address: "riley@northstar.example", name: "Riley Park", source: "auto" },
      { address: "jamie@talent.example", name: "Jamie Rivera", source: "manual" },
    ],
    emailBodies: makeEmailBodies(lanes, carryover),
    snoozedEmails: {} as Record<string, { row: DemoSnapshotEmail; lane: DemoLaneKey | "carryover" | null }>,
  };
}
