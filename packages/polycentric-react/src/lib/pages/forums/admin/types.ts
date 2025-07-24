export interface Category {
  id: string;
  name: string;
  description: string;
  order: number;
  boards: Board[];
}

export interface Board {
  id: string;
  category_id: string;
  name: string;
  description: string;
  order: number;
}

export interface ForumUser {
  public_key: Uint8Array;
  first_post_at: string;
  last_post_at: string;
  total_posts: number;
  total_threads: number;
}

export interface BannedUser {
  id: string;
  public_key: Uint8Array;
  banned_by: Uint8Array;
  reason?: string;
  created_at: string;
}
