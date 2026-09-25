import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTimelineItems } from '../../algorithms/timeline';
import { emptyDerived } from '../../state/derive';
import { useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { RouteWeatherPoint } from '../../types/weather';
import { WeatherStrip as WeatherTimeline } from './WeatherStrip';

const T0 = Date.UTC(2026, 8, 26, 4, 0);
const initial = useAppStore.getState();

function point(i: number, name: string, minutes: number): RouteWeatherPoint {
  const arrivalMs = T0 + minutes * 60000;
  return {
    id: `p${i}`,
    latitude: 41.7,
    longitude: 44.8 - i * 0.5,
    distanceFromStartKm: i * 60,
    estimatedTravelMinutes: minutes,
    estimatedArrivalUtc: new Date(arrivalMs).toISOString(),
    arrivalMs,
    localTime: `${String(8 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    timezone: 'Asia/Tbilisi',
    placeName: name,
    placeRelation: 'in',
    weather: {
      condition: i === 2 ? 'RAIN' : 'CLOUDY',
      temperature: 18 - i,
      precipitationProbability: i === 2 ? 65 : 10,
      isDay: true,
      forecastHourUtc: arrivalMs,
    },
    forecastLeadHours: minutes / 60,
    confidence: 'high',
    status: 'upcoming',
    reasons: ['settlement'],
  };
}

const points = [point(0, 'Tbilisi', 0), point(1, 'Gori', 70), point(2, 'Khashuri', 125), point(3, 'Batumi', 293)];

beforeEach(() => {
  useSettings.getState().update({ language: 'en', units: { distance: 'metric', temperature: 'c', wind: 'kmh' } });
  useAppStore.setState(initial, true);
  useAppStore.setState({
    derived: { ...emptyDerived, points, displayPoints: points, timelineItems: buildTimelineItems(points) },
  });
  // jsdom has no layout; give cards measurable geometry.
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get() {
      const id = (this as HTMLElement).dataset?.pointId;
      return id ? Number(id.slice(1)) * 110 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 });
  Element.prototype.scrollTo = vi.fn() as never;
});

afterEach(() => {
  delete (HTMLElement.prototype as { offsetLeft?: number }).offsetLeft;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

describe('WeatherStrip ↔ map synchronization', () => {
  it('renders one card per map marker, in route order, with ETA and weather', () => {
    render(<WeatherTimeline />);
    const cards = screen.getAllByRole('button');
    expect(cards.map((c) => c.getAttribute('data-point-id'))).toEqual(
      useAppStore.getState().derived.displayPoints.map((p) => p.id),
    );
    expect(cards[2]).toHaveAccessibleName('Khashuri, ETA 10:05, Rain, 16°, 65%');
    expect(cards[2]).toHaveTextContent(/ETA\s*10:05/);
    expect(cards[0]).toHaveTextContent(/Leave\s*08:00/);
  });

  it('tapping a card selects its route point for the map (source: timeline)', () => {
    render(<WeatherTimeline />);
    fireEvent.click(screen.getByRole('button', { name: /Khashuri/ }));
    const s = useAppStore.getState();
    expect(s.selectedPointId).toBe('p2');
    expect(s.selectionSource).toBe('timeline');
    expect(s.highlightedPointId).toBe('p2');
    expect(screen.getByRole('button', { name: /Khashuri/ })).toHaveAttribute('aria-pressed', 'true');
    // tapping again deselects
    fireEvent.click(screen.getByRole('button', { name: /Khashuri/ }));
    expect(useAppStore.getState().selectedPointId).toBeNull();
  });

  it('a map marker tap scrolls the matching card into view', () => {
    render(<WeatherTimeline />);
    act(() => useAppStore.getState().select('p3', 'map'));
    expect(Element.prototype.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 3 * 110 - 50 + 50 }));
    expect(screen.getByRole('button', { name: /Batumi/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('scrolling the timeline highlights the centred card on the map', async () => {
    render(<WeatherTimeline />);
    const list = screen.getByRole('list');
    Object.defineProperty(list, 'scrollLeft', { configurable: true, value: 180 });
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 100 });
    await act(async () => {
      fireEvent.scroll(list);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    // viewport centre = 230 → card p2 (220–320) is closest
    expect(useAppStore.getState().highlightedPointId).toBe('p2');
    expect(useAppStore.getState().selectedPointId).toBeNull();
  });
});
