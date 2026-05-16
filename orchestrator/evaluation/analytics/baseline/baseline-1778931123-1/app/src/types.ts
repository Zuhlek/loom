export interface Bookmark {
  id: number;
  url: string;
  title: string;
  created_at: string;
}

export interface CreateBookmarkInput {
  url: string;
  title: string;
}
