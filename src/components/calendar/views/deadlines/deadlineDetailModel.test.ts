import { describe, expect, it } from "vitest";
import {
  deadlineContextLabel,
  deadlineDueBadgeLabel,
  deadlineDueDetailLabel,
  deadlineSecondaryMeta,
  deadlineTitle,
} from "./deadlineDetailModel.ts";

describe("deadline detail model", () => {
  it("derives display labels from domain deadline shapes", () => {
    const todoistTask = {
      title: "Submit annotated bibliography",
      project_name: "School",
      due_date: "2026-05-02",
      due_time: "3:30 PM",
    };
    const classTask = {
      name: "Quiz window closes",
      class_name: "Data Systems",
    };

    expect(deadlineTitle(todoistTask)).toBe("Submit annotated bibliography");
    expect(deadlineTitle(classTask)).toBe("Quiz window closes");
    expect(deadlineTitle({})).toBe("Untitled task");
    expect(deadlineContextLabel(todoistTask)).toBe("School");
    expect(deadlineContextLabel(classTask)).toBe("Data Systems");
    expect(deadlineDueBadgeLabel(todoistTask, 0)).toBe("Today");
    expect(deadlineDueBadgeLabel(classTask, null)).toBe("No due date");
    expect(deadlineDueDetailLabel(todoistTask)).toBe("3:30 PM");
    expect(deadlineDueDetailLabel({ due_date: "2026-05-02" })).toBe("End of day");
    expect(deadlineSecondaryMeta(classTask)).toBe("Data Systems");
  });

  it("labels completed historical deadlines as complete instead of overdue", () => {
    expect(deadlineDueBadgeLabel({
      title: "Past task",
      due_date: "2026-04-18",
      status: "complete",
    }, -14)).toBe("Complete");
  });

});
