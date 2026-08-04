import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({ geocodeLocation: vi.fn() }));

// test-architecture: allow-boundary-mock -- location lookup crosses the authenticated geocoding HTTP/provider boundary while selection stays rendered.
vi.mock("@/api", () => mockApi);

const { default: WeatherLocationCard } = await import("./WeatherLocationCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WeatherLocationCard", () => {
  it("hydrates the saved location and coordinates from settings", () => {
    render(
      <WeatherLocationCard
        settings={{ weather_location: "Seattle, WA", weather_lat: 47.6062, weather_lng: -122.3321 }}
        patch={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Seattle, WA")).toBeTruthy();
    expect(screen.getByText("47.6062, -122.3321")).toBeTruthy();
  });

  it("patches the chosen result when geocoding returns multiple matches", async () => {
    mockApi.geocodeLocation.mockResolvedValue([
      { name: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
      { name: "Los Angeles County, CA", lat: 34.155, lng: -118.25 },
    ]);
    render(<WeatherLocationCard settings={{}} patch={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("El Monte, CA"), {
      target: { value: "Los Angeles" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    // Multiple matches render a result list rather than auto-selecting.
    expect(await screen.findByText("Los Angeles County, CA")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /los angeles, ca/i }));

    expect(await screen.findByText("34.0522, -118.2437")).toBeTruthy();
  });

  it("auto-selects and patches when geocoding returns a single match", async () => {
    mockApi.geocodeLocation.mockResolvedValue([
      { name: "El Monte, CA", lat: 34.0686, lng: -118.0276 },
    ]);
    render(<WeatherLocationCard settings={{}} patch={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("El Monte, CA"), {
      target: { value: "El Monte" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("34.0686, -118.0276")).toBeTruthy();
  });
});
