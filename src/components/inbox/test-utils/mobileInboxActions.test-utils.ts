import { fireEvent, screen, within } from "@testing-library/react";

export function openMobileEmailActions() {
  fireEvent.click(screen.getByRole("button", { name: "More email actions" }));
  return within(screen.getByRole("dialog", { name: "Email actions" }));
}

export function openMobileInboxSearch() {
  if (!screen.queryByRole("searchbox", { name: "Search indexed mail" })) {
    fireEvent.click(screen.getByRole("button", { name: "Search mail" }));
  }
  return screen.getByRole("searchbox", { name: "Search indexed mail" });
}
