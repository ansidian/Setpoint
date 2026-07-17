import { describe, expect, it } from "vitest";
import {
  resolveAddTaskLabels,
  resolveAddTaskDue,
  buildAddTaskDraftPreview,
  buildOriginalDueValue,
  buildAddTaskDirtySnapshot,
  buildAddTaskDirtyBaseline,
} from "./addTaskViewModel";

describe("resolveAddTaskLabels", () => {
  it("uses manual labels once labels are overridden", () => {
    const manual = [{ id: "1", name: "urgent" }];
    expect(resolveAddTaskLabels({ useManualLabels: true, manualLabels: manual, parsedLabels: [] })).toBe(manual);
    expect(resolveAddTaskLabels({ useManualLabels: true, manualLabels: null, parsedLabels: [{ name: "x" }] })).toEqual([]);
  });

  it("uses parsed labels (or empty) when not overridden", () => {
    const parsed = [{ name: "home" }];
    expect(resolveAddTaskLabels({ useManualLabels: false, manualLabels: null, parsedLabels: parsed })).toBe(parsed);
    expect(resolveAddTaskLabels({ useManualLabels: false, manualLabels: null, parsedLabels: [] })).toEqual([]);
  });
});

describe("resolveAddTaskDue", () => {
  const parsed = {
    recurringDueString: null,
    dateDueString: null,
    datePhrase: null,
    dateFormatted: null,
    recurrenceSummary: null,
  };

  it("prefers the manual due when overridden", () => {
    const out = resolveAddTaskDue({
      useManualDue: true,
      manualDue: { dueString: "2026-04-22 at 9:00 AM", display: "April 22", epochMs: 123 },
      parsed,
      seededCreateDue: { dueString: "seed" },
      seededDueDisplay: "seedDisplay",
      seededDueEpoch: 999,
    });
    expect(out.resolvedDue).toBe("2026-04-22 at 9:00 AM");
    expect(out.dueDisplay).toBe("April 22");
    expect(out.recurrenceSummary).toBeNull();
    expect(out.pickerDueEpoch).toBe(123);
  });

  it("falls through parsed -> seed when not overridden", () => {
    const out = resolveAddTaskDue({
      useManualDue: false,
      manualDue: null,
      parsed: { ...parsed, dateDueString: "tomorrow 9am", recurrenceSummary: "Every Mon" },
      seededCreateDue: { dueString: "seed" },
      seededDueDisplay: "seedDisplay",
      seededDueEpoch: 999,
    });
    expect(out.resolvedDue).toBe("tomorrow 9am");
    expect(out.dueDisplay).toBe("seedDisplay");
    expect(out.recurrenceSummary).toBe("Every Mon");
    expect(out.pickerDueEpoch).toBe(999);
  });

  it("prefers recurringDueString over dateDueString and datePhrase", () => {
    const out = resolveAddTaskDue({
      useManualDue: false,
      manualDue: null,
      parsed: { ...parsed, recurringDueString: "every weekday", dateDueString: "tomorrow", datePhrase: "next week" },
      seededCreateDue: { dueString: "seed" },
      seededDueDisplay: "",
      seededDueEpoch: null,
    });
    expect(out.resolvedDue).toBe("every weekday");
  });

  it("uses the create-mode seed string when nothing parsed", () => {
    const out = resolveAddTaskDue({
      useManualDue: false,
      manualDue: null,
      parsed,
      seededCreateDue: { dueString: "2026-04-22 at 9:00 AM" },
      seededDueDisplay: "",
      seededDueEpoch: null,
    });
    expect(out.resolvedDue).toBe("2026-04-22 at 9:00 AM");
    expect(out.dueDisplay).toBe("");
    expect(out.pickerDueEpoch).toBeNull();
  });
});

describe("buildAddTaskDraftPreview", () => {
  const base = {
    manualDueEpochMs: null,
    useManualDue: false,
    parsedDuePreview: null,
    parsedStripped: "Call dentist",
    seededDueEpoch: null,
    editingDueDate: null,
    editingDueTime: null,
    isEdit: false,
    input: "Call dentist tomorrow",
    resolvedPriority: 2,
  };

  it("returns null when no due source resolves", () => {
    expect(buildAddTaskDraftPreview(base)).toBeNull();
  });

  it("builds a create preview (always placementChanged) from the parsed due", () => {
    const out = buildAddTaskDraftPreview({
      ...base,
      parsedDuePreview: { dueDate: "2026-04-20", dueTime: "9 AM" },
    });
    expect(out).toMatchObject({
      kind: "deadline",
      title: "Call dentist",
      dueDate: "2026-04-20",
      dueTime: "9 AM",
      priority: 2,
      source: "todoist",
      isEditing: false,
      placementChanged: true,
    });
  });

  it("marks an unchanged edit as placementChanged: false", () => {
    const out = buildAddTaskDraftPreview({
      ...base,
      isEdit: true,
      editingDueDate: "2026-04-21",
      editingDueTime: "2:30 PM",
      parsedDuePreview: { dueDate: "2026-04-21", dueTime: "2:30 PM" },
    });
    expect(out!.placementChanged).toBe(false);
  });

  it("marks an edit whose date or time moved as placementChanged: true", () => {
    const movedDate = buildAddTaskDraftPreview({
      ...base,
      isEdit: true,
      editingDueDate: "2026-04-21",
      editingDueTime: "2:30 PM",
      parsedDuePreview: { dueDate: "2026-04-20", dueTime: "2:30 PM" },
    });
    expect(movedDate!.placementChanged).toBe(true);

    const movedTime = buildAddTaskDraftPreview({
      ...base,
      isEdit: true,
      editingDueDate: "2026-04-21",
      editingDueTime: "2:30 PM",
      parsedDuePreview: { dueDate: "2026-04-21", dueTime: "9 AM" },
    });
    expect(movedTime!.placementChanged).toBe(true);
  });

  it("treats an edit with no time on either side (same date) as unchanged", () => {
    const out = buildAddTaskDraftPreview({
      ...base,
      isEdit: true,
      editingDueDate: "2026-04-21",
      editingDueTime: null,
      parsedDuePreview: { dueDate: "2026-04-21", dueTime: null },
    });
    expect(out!.placementChanged).toBe(false);
  });

  it("falls back through stripped -> input -> editing title", () => {
    const fromInput = buildAddTaskDraftPreview({
      ...base,
      parsedStripped: "",
      input: "  Raw input  ",
      parsedDuePreview: { dueDate: "2026-04-20", dueTime: null },
    });
    expect(fromInput!.title).toBe("Raw input");

    const fromEditing = buildAddTaskDraftPreview({
      ...base,
      parsedStripped: "",
      input: "   ",
      editingTitle: "Existing",
      parsedDuePreview: { dueDate: "2026-04-20", dueTime: null },
    });
    expect(fromEditing!.title).toBe("Existing");
  });
});

describe("buildOriginalDueValue", () => {
  it("prefers due_string, then date+time join, for an editing task", () => {
    expect(buildOriginalDueValue({ editingTask: { due_string: "every weekday" } })).toBe("every weekday");
    expect(buildOriginalDueValue({ editingTask: { due_date: "2026-04-21", due_time: "2:30 PM" } }))
      .toBe("2026-04-21 2:30 PM");
    expect(buildOriginalDueValue({ editingTask: { due_date: "2026-04-21" } })).toBe("2026-04-21");
    expect(buildOriginalDueValue({ editingTask: { due_time: "2:30 PM" } })).toBe("2:30 PM");
    expect(buildOriginalDueValue({ editingTask: {} })).toBeNull();
  });

  it("uses the seeded create due string when there is no editing task", () => {
    expect(buildOriginalDueValue({ editingTask: null, seededDueString: "seed" })).toBe("seed");
    expect(buildOriginalDueValue({ editingTask: null, seededDueString: null })).toBeNull();
  });
});

describe("dirty snapshot vs baseline", () => {
  const editingTask = {
    title: "Follow up",
    description: "",
    project_id: "p1",
    priority: 4 as const,
    labels: ["IHSS"],
    due_string: "2026-04-21 2:30 PM",
  };
  const originalDueValue = buildOriginalDueValue({ editingTask });

  function snapshotFor(overrides = {}) {
    return buildAddTaskDirtySnapshot({
      parsedStripped: "Follow up",
      input: "Follow up",
      description: "",
      resolvedProjectName: null,
      resolvedProjectId: "p1",
      resolvedPriority: 4,
      resolvedLabels: [{ name: "IHSS" }],
      isEdit: true,
      useManualDue: false,
      originalDueValue,
      resolvedDue: null,
      ...overrides,
    });
  }

  it("matches the baseline for an unchanged edit (not dirty)", () => {
    const baseline = buildAddTaskDirtyBaseline({ editingTask, originalDueValue });
    expect(snapshotFor()).toBe(baseline);
  });

  it("diverges from the baseline when a field changes (dirty)", () => {
    const baseline = buildAddTaskDirtyBaseline({ editingTask, originalDueValue });
    expect(snapshotFor({ parsedStripped: "Follow up later", input: "Follow up later" })).not.toBe(baseline);
    expect(snapshotFor({ resolvedPriority: 1 })).not.toBe(baseline);
    expect(snapshotFor({ resolvedLabels: [] })).not.toBe(baseline);
  });
});
