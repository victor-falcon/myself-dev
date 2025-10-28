export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: {
    login: string;
  };
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  draft: boolean;
  state: 'open' | 'closed';
  head: {
    ref: string;
  };
  base: {
    ref: string;
  };
  repository: {
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
}

export interface ReviewRequest {
  id: number;
  requested_reviewer?: {
    login: string;
  };
  requested_team?: {
    name: string;
  };
}

export interface Team {
  id: number;
  name: string;
  slug: string;
}

export interface User {
  login: string;
  id: string | number;
}

export interface ReviewCriteria {
  maxAdditions: number;
  maxDeletions: number;
  maxChangedFiles: number;
  maxLinesChanged: number;
}