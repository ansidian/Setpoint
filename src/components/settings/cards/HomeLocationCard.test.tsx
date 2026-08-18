import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeLocationCard from "./HomeLocationCard";

const api = vi.hoisted(() => ({
  getCalendarPlaceSuggestions: vi.fn(),
  getCalendarPlaceDetails: vi.fn(),
  updateSettings: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- Places details and Settings writes are the card's outbound HTTP boundaries; the tests keep provider/network traffic inert.
vi.mock("@/api", () => api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomeLocationCard", () => {
  it("selects and saves one complete Home tuple without displaying coordinates", async () => {
    api.getCalendarPlaceSuggestions.mockResolvedValue({
      places: [{
        placeId: "home-place",
        primaryText: "Home",
        secondaryText: "123 Private Way",
        fullText: "Home, 123 Private Way",
        distanceMeters: null,
      }],
    });
    api.getCalendarPlaceDetails.mockResolvedValue({
      place: {
        placeId: "home-place",
        displayName: "Home",
        formattedAddress: "123 Private Way, Pasadena, CA",
        location: "123 Private Way, Pasadena, CA",
        lat: 34.1478,
        lng: -118.1445,
        googleMapsUri: "https://maps.google.com/demo",
      },
    });
    api.updateSettings.mockResolvedValue({ success: true });

    render(<HomeLocationCard settings={{}} onRefreshConnections={vi.fn(async () => {})} />);
    fireEvent.change(screen.getByLabelText("Choose Home"), { target: { value: "home" } });
    fireEvent.click(await screen.findByRole("option", { name: /Home/ }));

    // test-architecture: allow-boundary-interaction -- The atomic private Home tuple is an outbound Settings contract and coordinates are intentionally absent from the rendered result.
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
      home_location_label: "Home",
      home_location_address: "123 Private Way, Pasadena, CA",
      home_location_place_id: "home-place",
      home_location_lat: 34.1478,
      home_location_lng: -118.1445,
    }));
    expect(screen.getByText("123 Private Way, Pasadena, CA")).toBeTruthy();
    expect(screen.queryByText(/34\.1478|-118\.1445/)).toBeNull();
  });

  it("requires confirmation and clears all five Home fields together", async () => {
    api.updateSettings.mockResolvedValue({ success: true });
    render(
      <HomeLocationCard
        settings={{ home_location_label: "Home", home_location_address: "123 Private Way" }}
        onRefreshConnections={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Home" }));
    expect(screen.getByText(/blocks every pending Time-to-Leave reminder/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Home" }));

    // test-architecture: allow-boundary-interaction -- Clearing all five Home fields together is an outbound Settings contract not observable from the address-only saved-state UI.
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
      home_location_label: null,
      home_location_address: null,
      home_location_place_id: null,
      home_location_lat: null,
      home_location_lng: null,
    }));
  });
});
