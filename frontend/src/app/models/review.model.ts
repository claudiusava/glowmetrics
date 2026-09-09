export interface Review {
  reviewId: string;
  number: number;
  rating: number;
  author: string;
  text: string;
  publishedAt: string;
  source: string;
}

export interface ReviewsResponse {
  totalCount: number;
  reviews: Review[];
  updated?: boolean;
  newReviewsCount?: number;
}

export interface MonthlyGoal {
  count: number;
  goal: number;
  monthKey: string;
}

export interface AirtableKpi {
  pct: number;
  total: number;
  citadas: number;
  stale: boolean;
  updatedAt: string;
  refreshed?: boolean;
}

export interface MonthlyHistoryEntry {
  monthKey: string;
  count: number | null;
  met: boolean | null;
}
