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

export function buildDemoWeather(today: Date) {
  return {
    temp: 72,
    high: 76,
    low: 60,
    icon: "Sun",
    summary: "Clear. High of 76°F, low of 60°F.",
    hourly: [
      { time: "Now", temp: 72, icon: "Sun", now: true },
      { time: "3p", temp: 75, icon: "Sun" },
      { time: "5p", temp: 74, icon: "CloudSun" },
      { time: "7p", temp: 69, icon: "CloudSun" },
      { time: "9p", temp: 65, icon: "Moon" },
      { time: "11p", temp: 62, icon: "Moon" },
    ],
    dailyForecast: [
      { dateKey: dateKey(today), high: 76, low: 60, icon: "Sun", rain: 0 },
      { dateKey: dateKey(addDays(today, 1)), high: 74, low: 59, icon: "CloudSun", rain: 10 },
      { dateKey: dateKey(addDays(today, 2)), high: 68, low: 57, icon: "CloudRain", rain: 65 },
      { dateKey: dateKey(addDays(today, 3)), high: 73, low: 58, icon: "Sun", rain: 5 },
    ],
  };
}
