import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../../services/providers';
import { useSettings } from '../../state/settings';
import { __resetStoreRuntime, useAppStore } from '../../state/store';
import { installFakeProviders, type Harness } from '../../test/harness';
import { tbilisiBatumiDetour } from '../../test/helpers';
import { RouteOptions } from './RouteOptions';

const BASE = Date.UTC(2026, 8, 26, 4, 0); // 08:00 in Tbilisi
const initial = useAppStore.getState();
let h: Harness;

async function plan() {
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  useAppStore.setState(initial, true);
  useSettings.getState().update({ language: 'en', units: { distance: 'metric', temperature: 'c', wind: 'kmh' } });
  h = installFakeProviders(BASE);
  // Rain only far in the north, which only the detour reaches.
  h.weather.hourFn = (lat, _lon, hourMs) => {
    const raining = lat > 42.4 && hourMs - BASE >= 3600_000;
    return { temperature: 18, code: raining ? 63 : 1, precipitation: raining ? 1.5 : 0, precipitationProbability: raining ? 80 : 5 };
  };
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('<RouteOptions> — a forecast on every road', () => {
  it('renders nothing for a single road', async () => {
    await plan();
    const { container } = render(<RouteOptions />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each road with its time, distance and its own forecast stops', async () => {
    h.alternativeRoads.push(tbilisiBatumiDetour(0.3, 0.7, 0.5, 1.15));
    await plan();
    render(<RouteOptions />);

    const roads = screen.getAllByRole('radio');
    expect(roads).toHaveLength(2);
    expect(within(roads[0]).getByText('Fastest')).toBeInTheDocument();
    expect(within(roads[1]).getByText('Alternative 1')).toBeInTheDocument();
    // The forecast is on both cards, not only on the selected one.
    for (const road of roads) {
      const forecast = within(road).getByRole('group', { name: /Forecast along this road/ });
      expect(within(forecast).getByText('08:00')).toBeInTheDocument();
      expect(within(forecast).getByText('Tbilisi')).toBeInTheDocument();
      expect(within(forecast).getByText('Batumi')).toBeInTheDocument();
      expect(within(forecast).getAllByText('18°').length).toBeGreaterThanOrEqual(2);
    }
    // …and they differ: the northern road runs into rain, the main one stays dry.
    expect(within(roads[0]).getByText('Mostly dry')).toBeInTheDocument();
    expect(within(roads[1]).getByText(/min in rain/)).toBeInTheDocument();
    expect(roads[0]).toHaveAttribute('aria-checked', 'true');
    expect(roads[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('colours the ribbon by the weather along the road', async () => {
    h.alternativeRoads.push(tbilisiBatumiDetour(0.3, 0.7, 0.5, 1.15));
    await plan();
    render(<RouteOptions />);
    const [main, north] = screen.getAllByRole('radio');
    const classes = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.rfc__seg')].map((s) => s.dataset.wx);
    expect(classes(main)).not.toContain('rain');
    expect(classes(north)).toContain('rain');
  });

  it('calls the fastest road "Fastest" and numbers the others from 1, whatever order the router gave', async () => {
    h.alternativeRoads.push(tbilisiBatumiDetour(0.3, 0.7, 0.5, 0.8)); // faster than the router's best
    await plan();
    render(<RouteOptions />);
    const [first, second] = screen.getAllByRole('radio');
    expect(within(first).getByText('Alternative 1')).toBeInTheDocument();
    expect(within(second).getByText('Fastest')).toBeInTheDocument();
    expect(screen.queryByText('Alternative 0')).toBeNull();
  });

  it('choosing a card selects that road', async () => {
    h.alternativeRoads.push(tbilisiBatumiDetour(0.3, 0.7, 0.5, 1.15));
    await plan();
    render(<RouteOptions />);
    const alt = screen.getAllByRole('radio')[1];
    alt.click();
    await vi.waitFor(() => expect(useAppStore.getState().selectedOption).toBe(1));
    expect(useAppStore.getState().plan).toBe(useAppStore.getState().routeOptions[1]);
  });
});
