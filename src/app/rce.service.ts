import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { RcePoint, RceResponse } from './rce.model';

@Injectable({ providedIn: 'root' })
export class RceService {
  private readonly http = inject(HttpClient);
  // PSE API allows CORS from any origin, so we can call it directly (no proxy needed)
  private readonly url = 'https://api.raporty.pse.pl/api/rce-pln';

  getForDate(businessDate: string): Observable<RcePoint[]> {
    const params = new HttpParams().set('$filter', `business_date eq '${businessDate}'`);
    return this.http
      .get<RceResponse>(this.url, { params })
      .pipe(map((r) => [...(r.value ?? [])].sort((a, b) => a.dtime.localeCompare(b.dtime))));
  }
}
