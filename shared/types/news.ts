export type NewsSourceKind = "rss" | "hn";

export interface NewsSource {
  id: number;
  topicId: number;
  kind: NewsSourceKind;
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  enabled: boolean;
  hnQuery: string | null;
  minPoints: number | null;
  lastStatus: string | null;
  lastFetchAt: string | null;
  consecutiveFailures: number;
}

export interface NewsItem {
  id: number;
  sourceId: number;
  sourceTitle: string;
  siteUrl: string | null;
  url: string;
  title: string;
  excerpt: string;
  author: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
}

export interface NewsTopic {
  id: number;
  name: string;
  position: number;
  sources: NewsSource[];
  items: NewsItem[];
  mutedTerms: string[];
}

export interface NewsPageEnvelope {
  lastSeenAt: string | null;
  lastUpdatedAt: string | null;
  topics: NewsTopic[];
}

export interface NewsCatalogRssSource {
  kind: "rss";
  title: string;
  feedUrl: string;
  siteUrl: string;
}

export interface NewsCatalogHnSource {
  kind: "hn";
  title: string;
  hnQuery: string;
  minPoints: number;
}

export type NewsCatalogSource = NewsCatalogRssSource | NewsCatalogHnSource;

export interface NewsCatalogTopic {
  name: string;
  sources: NewsCatalogSource[];
}

export interface NewsCatalogResponse {
  topics: NewsCatalogTopic[];
}

export interface NewsSourcePreview {
  feedUrl: string;
  title: string;
  sampleTitles: string[];
}

export type CreateNewsSourceRequest =
  | {
      topicId: number;
      kind: "rss";
      title: string;
      feedUrl: string;
      siteUrl?: string | null;
    }
  | {
      topicId: number;
      kind: "hn";
      title: string;
      hnQuery?: string;
      minPoints?: number;
    };

export interface UpdateNewsSourceRequest {
  enabled?: boolean;
  title?: string;
  minPoints?: number;
}

export interface NewsMutationResponse {
  ok: true;
}

export interface CreateNewsTopicResponse {
  id: number;
  name: string;
}

export interface CreateNewsSourceResponse {
  source: {
    id: number;
    topicId: number;
    kind: NewsSourceKind;
    title: string;
    feedUrl: string;
  };
}

export interface ImportNewsTopicsResponse {
  imported: string[];
}

export interface MarkNewsSeenResponse extends NewsMutationResponse {
  at: string;
}

export interface RefreshNewsResponse {
  swept: number;
  skipped?: boolean;
  throttled: boolean;
}
