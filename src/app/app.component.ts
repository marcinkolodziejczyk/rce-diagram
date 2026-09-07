import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RceService } from './rce.service';
import { RcePoint } from './rce.model';

interface ChartPoint {
  x: number;
  y: number;
  point: RcePoint;
}

interface Bar extends ChartPoint {
  barX: number;
  barY: number;
  width: number;
  height: number;
  fill: string;
}

type ChartMode = 'line' | 'bars' | 'hourly';

type Hsl = [number, number, number];

// skala barw: 0 = niebieski, w górę zielony → żółty → pomarańczowy → czerwony, w dół fiolety
const POSITIVE_STOPS: { t: number; hsl: Hsl }[] = [
  { t: 0, hsl: [220, 85, 55] },
  { t: 0.12, hsl: [165, 65, 45] },
  { t: 0.35, hsl: [110, 60, 45] },
  { t: 0.55, hsl: [55, 85, 50] },
  { t: 0.78, hsl: [28, 90, 52] },
  { t: 1, hsl: [0, 80, 48] }
];

const NEGATIVE_STOPS: { t: number; hsl: Hsl }[] = [
  { t: 0, hsl: [220, 85, 55] },
  { t: 0.5, hsl: [270, 70, 52] },
  { t: 1, hsl: [300, 75, 32] }
];

function colorAt(stops: { t: number; hsl: Hsl }[], t: number): string {
  const c = Math.min(1, Math.max(0, t));
  let i = stops.length - 1;
  while (i > 0 && stops[i - 1].t > c) i--;
  const a = stops[Math.max(0, i - 1)];
  const b = stops[i];
  const f = b.t === a.t ? 0 : (c - a.t) / (b.t - a.t);
  const [h, s, l] = a.hsl.map((v, k) => v + (b.hsl[k] - v) * f);
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

const W = 900;
const H = 360;
const PAD = { top: 20, right: 20, bottom: 34, left: 60 };
// udział wysokości wykresu poniżej zera – dzięki temu poziom 0 jest zawsze w tym samym miejscu
const ZERO_RATIO = 0.25;

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  private readonly rce = inject(RceService);

  readonly W = W;
  readonly H = H;
  readonly PAD = PAD;

  readonly date = signal(new Date().toLocaleDateString('pl-PL'));
  readonly mode = signal<ChartMode>('line');
  readonly now = signal(new Date());
  readonly data = signal<RcePoint[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly hovered = signal<ChartPoint | null>(null);

  readonly stats = computed(() => {
    const values = this.data().map((d) => d.rce_pln);
    if (!values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { min, max, avg };
  });

  private readonly scale = computed(() => {
    const s = this.stats();
    const pos = Math.max(s ? s.max : 0, 0);
    const neg = Math.max(s ? -s.min : 0, 0);
    const unit = Math.max(pos / (1 - ZERO_RATIO), neg / ZERO_RATIO, 1) * 1.05;
    return { yMin: -unit * ZERO_RATIO, yMax: unit * (1 - ZERO_RATIO) };
  });

  readonly zeroY = computed(() => {
    const innerH = H - PAD.top - PAD.bottom;
    return PAD.top + innerH * (1 - ZERO_RATIO);
  });

  readonly series = computed<RcePoint[]>(() => {
    const items = this.data();
    if (this.mode() !== 'hourly') return items;
    const groups = new Map<string, RcePoint[]>();
    for (const item of items) {
      const hour = item.period.slice(0, 2);
      const group = groups.get(hour);
      if (group) {
        group.push(item);
      } else {
        groups.set(hour, [item]);
      }
    }
    return [...groups.entries()].map(([hour, group]) => ({
      ...group[0],
      rce_pln: group.reduce((a, b) => a + b.rce_pln, 0) / group.length,
      period: `${hour}:00 - ${String((+hour + 1) % 24).padStart(2, '0')}:00`
    }));
  });

  readonly points = computed<ChartPoint[]>(() => {
    const items = this.series();
    if (!items.length) return [];
    const { yMin, yMax } = this.scale();
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const bars = this.mode() !== 'line';
    const slot = innerW / items.length;
    const step = items.length > 1 ? innerW / (items.length - 1) : 0;
    return items.map((point, i) => ({
      x: bars ? PAD.left + (i + 0.5) * slot : PAD.left + i * step,
      y: PAD.top + innerH - ((point.rce_pln - yMin) / (yMax - yMin)) * innerH,
      point
    }));
  });

  readonly bars = computed<Bar[]>(() => {
    const pts = this.points();
    if (this.mode() === 'line' || !pts.length) return [];
    const s = this.stats()!;
    const slot = (W - PAD.left - PAD.right) / pts.length;
    const width = Math.max(slot * 0.88, 1);
    const zero = this.zeroY();
    const maxPos = Math.max(s.max, 1);
    const maxNeg = Math.max(-s.min, 1);
    return pts.map((p) => {
      const v = p.point.rce_pln;
      const fill =
        v >= 0 ? colorAt(POSITIVE_STOPS, v / maxPos) : colorAt(NEGATIVE_STOPS, -v / maxNeg);
      return {
        ...p,
        barX: p.x - width / 2,
        barY: Math.min(p.y, zero),
        width,
        height: Math.max(Math.abs(p.y - zero), 1),
        fill
      };
    });
  });

  readonly linePath = computed(() =>
    this.points()
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ')
  );

  readonly areaPath = computed(() => {
    const pts = this.points();
    if (!pts.length) return '';
    const base = this.zeroY().toFixed(2);
    return `${this.linePath()} L${pts[pts.length - 1].x.toFixed(2)},${base} L${pts[0].x.toFixed(2)},${base} Z`;
  });

  readonly yTicks = computed(() => {
    const { yMin, yMax } = this.scale();
    const innerH = H - PAD.top - PAD.bottom;
    return Array.from({ length: 5 }, (_, i) => ({
      value: yMin + ((yMax - yMin) * i) / 4,
      y: PAD.top + innerH - (innerH * i) / 4
    }));
  });

  readonly xTicks = computed(() =>
    this.points()
      // pełne godziny (okres zaczynający się o :00), co 3 godziny
      .filter((p) => p.point.period.slice(3, 5) === '00')
      .filter((_, i) => i % 3 === 0)
      .map((p) => ({ x: p.x, label: p.point.period.slice(0, 5) }))
  );

  readonly nowMarker = computed(() => {
    const now = this.now();
    const pts = this.points();
    if (!pts.length || this.date() !== now.toLocaleDateString('pl-PL')) return null;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const index = Math.min(pts.length - 1, Math.floor((minutes / 1440) * pts.length));
    return { x: pts[index].x, label: now.toTimeString().slice(0, 5) };
  });

  constructor() {
    this.load();
    let lastQuarter = this.quarterOf(new Date());
    const timer = setInterval(() => {
      const now = new Date();
      this.now.set(now);
      const quarter = this.quarterOf(now);
      if (quarter !== lastQuarter) {
        lastQuarter = quarter;
        if (this.date() === now.toLocaleDateString('pl-PL')) {
          this.load();
        }
      }
    }, 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private quarterOf(d: Date): string {
    return `${d.toLocaleDateString('pl-PL')} ${d.getHours()}:${Math.floor(d.getMinutes() / 15)}`;
  }

  load(): void {
    const d = this.date();
    if (!d) return;
    this.loading.set(true);
    this.error.set(null);
    this.hovered.set(null);
    this.rce.getForDate(d).subscribe({
      next: (items) => {
        this.data.set(items);
        this.loading.set(false);
      },
      error: (err) => {
        this.data.set([]);
        this.error.set(err?.message ?? 'Nie udało się pobrać danych');
        this.loading.set(false);
      }
    });
  }

  shiftDay(days: number): void {
    const d = new Date(this.date() + 'T00:00:00');
    d.setDate(d.getDate() + days);
    this.date.set(d.toLocaleDateString('pl-PL'));
    this.load();
  }

  onMove(event: MouseEvent, svg: Element): void {
    const pts = this.points();
    if (!pts.length) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    let best = pts[0];
    for (const p of pts) {
      if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    }
    this.hovered.set(best);
  }

  clearHover(): void {
    this.hovered.set(null);
  }
}
