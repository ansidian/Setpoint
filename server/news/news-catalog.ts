// server/news/news-catalog.js
// Curated starter bundles. Import COPIES rows into the owner's tables —
// catalog edits never mutate followed feeds. URLs verified 2026-07-04.
import type { NewsCatalogTopic } from "../../shared/types/news.ts";

export const NEWS_STARTER_CATALOG = [
  {
    name: "3D Printing",
    sources: [
      { kind: "rss", title: "All3DP", feedUrl: "https://all3dp.com/feed/newsfeed", siteUrl: "https://all3dp.com" },
      { kind: "rss", title: "Tom's Hardware · 3D Printing", feedUrl: "https://www.tomshardware.com/feeds/tag/3d-printing", siteUrl: "https://www.tomshardware.com/3d-printing" },
      { kind: "rss", title: "Prusa Blog", feedUrl: "https://blog.prusa3d.com/feed/", siteUrl: "https://blog.prusa3d.com" },
    ],
  },
  {
    name: "PC Gaming",
    sources: [
      { kind: "rss", title: "PC Gamer", feedUrl: "https://www.pcgamer.com/feeds.xml", siteUrl: "https://www.pcgamer.com" },
      { kind: "rss", title: "Rock Paper Shotgun", feedUrl: "https://www.rockpapershotgun.com/feed", siteUrl: "https://www.rockpapershotgun.com" },
      { kind: "rss", title: "Eurogamer", feedUrl: "https://www.eurogamer.net/feed", siteUrl: "https://www.eurogamer.net" },
    ],
  },
  {
    name: "PC Hardware",
    sources: [
      { kind: "rss", title: "Tom's Hardware", feedUrl: "https://www.tomshardware.com/feeds.xml", siteUrl: "https://www.tomshardware.com" },
      { kind: "rss", title: "TechPowerUp", feedUrl: "https://www.techpowerup.com/rss/news", siteUrl: "https://www.techpowerup.com" },
      { kind: "rss", title: "GamersNexus (YouTube)", feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UChIs72whgZI9w6d6FhwGGHA", siteUrl: "https://www.youtube.com/@GamersNexus" },
      { kind: "rss", title: "ServeTheHome", feedUrl: "https://www.servethehome.com/feed/", siteUrl: "https://www.servethehome.com" },
    ],
  },
  {
    name: "AI",
    sources: [
      { kind: "hn", title: "Hacker News · AI (50+ pts)", hnQuery: "AI", minPoints: 50 },
      { kind: "rss", title: "TechCrunch · AI", feedUrl: "https://techcrunch.com/category/artificial-intelligence/feed/", siteUrl: "https://techcrunch.com/category/artificial-intelligence" },
    ],
  },
  {
    name: "Tech",
    sources: [
      { kind: "rss", title: "The Verge", feedUrl: "https://www.theverge.com/rss/index.xml", siteUrl: "https://www.theverge.com" },
      { kind: "rss", title: "Ars Technica", feedUrl: "https://arstechnica.com/feed/", siteUrl: "https://arstechnica.com" },
      { kind: "hn", title: "Hacker News · Front page (100+ pts)", hnQuery: "", minPoints: 100 },
    ],
  },
  {
    name: "Politics",
    sources: [
      { kind: "rss", title: "Politico", feedUrl: "https://rss.politico.com/politics-news.xml", siteUrl: "https://www.politico.com/politics" },
      { kind: "rss", title: "The Hill", feedUrl: "https://thehill.com/homenews/feed/", siteUrl: "https://thehill.com" },
      { kind: "rss", title: "PBS NewsHour · Politics", feedUrl: "https://www.pbs.org/newshour/feeds/rss/politics", siteUrl: "https://www.pbs.org/newshour/politics" },
      { kind: "rss", title: "NPR · Politics", feedUrl: "https://feeds.npr.org/1014/rss.xml", siteUrl: "https://www.npr.org/sections/politics" },
    ],
  },
  {
    name: "World",
    sources: [
      { kind: "rss", title: "BBC · World", feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml", siteUrl: "https://www.bbc.com/news/world" },
      { kind: "rss", title: "The Guardian · World", feedUrl: "https://www.theguardian.com/world/rss", siteUrl: "https://www.theguardian.com/world" },
      { kind: "rss", title: "Al Jazeera", feedUrl: "https://www.aljazeera.com/xml/rss/all.xml", siteUrl: "https://www.aljazeera.com" },
      { kind: "rss", title: "NPR · World", feedUrl: "https://feeds.npr.org/1004/rss.xml", siteUrl: "https://www.npr.org/sections/world" },
    ],
  },
  {
    name: "Product Launches",
    sources: [
      { kind: "hn", title: "Hacker News · launches (30+ pts)", hnQuery: "launch", minPoints: 30 },
      { kind: "rss", title: "The Verge", feedUrl: "https://www.theverge.com/rss/index.xml", siteUrl: "https://www.theverge.com" },
    ],
  },
] satisfies NewsCatalogTopic[];
