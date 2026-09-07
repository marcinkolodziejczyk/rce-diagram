export interface RcePoint {
  dtime: string;
  period: string;
  rce_pln: number;
  dtime_utc: string;
  period_utc: string;
  business_date: string;
  publication_ts: string;
  publication_ts_utc: string;
}

export interface RceResponse {
  value: RcePoint[];
}
