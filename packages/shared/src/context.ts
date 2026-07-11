export type ContextStrategy = 'none' | 'truncate' | 'summarize';

export interface TokenEstimate {
  total: number;
  input: number;
  output: number;
}
