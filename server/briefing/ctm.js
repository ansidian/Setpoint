const { CTM_API_URL, CTM_API_KEY } = process.env;

function formatTime12h(isoStr) {
  if (!isoStr) return "11:59 PM";
  if (isoStr.includes("T")) {
    if (/[Z+-]\d{0,4}$/.test(isoStr)) {
      return new Date(isoStr).toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    // Bare ISO — time is already Pacific, extract HH:MM directly
    const timePart = isoStr.split("T")[1];
    let [h, m] = timePart.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  }
  // "HH:MM" format
  let [h, m] = isoStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function toPacificDate(isoStr) {
  if (/[Z+-]\d{0,4}$/.test(isoStr)) {
    return new Date(isoStr).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  }
  return isoStr.split("T")[0];
}

function todayPacific() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function ctmFetch(path, options = {}) {
  const res = await fetch(`${CTM_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CTM_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CTM API ${res.status}: ${body}`);
  }
  return res.json();
}

function mapCTMEvent(e) {
  return {
    id: e.id,
    title: e.title,
    due_date: e.due_date?.includes("T") ? toPacificDate(e.due_date) : e.due_date,
    due_time: e.due_time ? formatTime12h(e.due_time) : e.due_date?.includes("T") ? formatTime12h(e.due_date) : null,
    class_name: e.class_name || "Uncategorized",
    class_color: e.class_color || "#6b7280",
    points_possible: e.points_possible || null,
    status: e.status,
    source: e.canvas_id ? "canvas" : "manual",
    todoist_id: e.todoist_id || null,
    description: e.description || "",
    url: e.url || null,
  };
}

export async function fetchCTMDeadlines() {
  if (!CTM_API_URL || !CTM_API_KEY) {
    console.warn("[CTM] No CTM API credentials — skipping deadlines");
    return [];
  }

  const today = todayPacific();

  // Include "complete" so tasks completed externally (in CTM directly) stay
  // visible until their due date passes. Fetch active items without a date
  // ceiling so overdue and future work both show up, but keep completed fetches
  // bounded to today+ so old completed history does not bloat the briefing.
  const activeParams = new URLSearchParams({
    status: "incomplete,in_progress",
    exclude_source: "todoist",
  });
  const completedParams = new URLSearchParams({
    status: "complete",
    due_after: today,
    exclude_source: "todoist",
  });

  const [activeEvents, completedEvents] = await Promise.all([
    ctmFetch(`/events?${activeParams}`),
    ctmFetch(`/events?${completedParams}`),
  ]);
  const events = [...activeEvents, ...completedEvents];
  return events.map(mapCTMEvent);
}

// Full-horizon fetch for the calendar modal: all incomplete items regardless of date.
export async function fetchCTMDeadlinesAll() {
  if (!CTM_API_URL || !CTM_API_KEY) {
    console.warn("[CTM] No CTM API credentials — skipping deadlines");
    return [];
  }

  const params = new URLSearchParams({
    status: "incomplete,in_progress",
    exclude_source: "todoist",
  });

  const events = await ctmFetch(`/events?${params}`);
  return events.map(mapCTMEvent);
}

export async function updateCTMEventStatus(eventId, status) {
  if (!CTM_API_URL || !CTM_API_KEY) return;
  return ctmFetch(`/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
