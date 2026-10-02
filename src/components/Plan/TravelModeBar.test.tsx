import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../../services/providers';
import { useSettings } from '../../state/settings';
import { __resetStoreRuntime, useAppStore } from '../../state/store';
import { installFakeProviders, type Harness } from '../../test/harness';
import { SearchPanel, transitTimetablesUrl } from '../Search/SearchPanel';
import { PlanSheet } from './PlanSheet';
import { TravelModeBar } from './TravelModeBar';

const BASE = Date.UTC(2026, 8, 26, 4, 0);
const initial = useAppStore.getState();
let harness: Harness;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  useAppStore.setState(initial, true);
  useSettings.getState().reset();
  useSettings.getState().update({ language: 'en' });
  harness = installFakeProviders(BASE);
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

async function plan() {
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
}

describe('<TravelModeBar>', () => {
  it('offers car, walking, bicycle, public transport and flight; the car is chosen first', () => {
    render(<TravelModeBar />);
    const modes = screen.getAllByRole('radio');
    expect(modes.map((b) => b.getAttribute('aria-label'))).toEqual(['Car', 'Walking', 'Bicycle', 'Public transport', 'Flight']);
    expect(modes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false']);
  });

  it('the chosen way shows how long the trip takes, the others only their icon', async () => {
    await plan();
    render(<TravelModeBar />);
    const car = screen.getByRole('radio', { name: 'Car' });
    expect(car.textContent).toMatch(/4 h 5\d min/);
    expect(screen.getByRole('radio', { name: 'Walking' }).textContent).toBe('');
  });

  it('choosing a mode selects it and plans the trip that way', async () => {
    await plan();
    render(<TravelModeBar />);
    screen.getByRole('radio', { name: 'Walking' }).click();
    expect(useAppStore.getState().travelMode).toBe('walk');
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'Walking' })).toHaveAttribute('aria-checked', 'true'));
    await vi.waitFor(() => expect(useAppStore.getState().plan!.timed.totalTimeS / 3600).toBeGreaterThan(40));
  });
});

describe('the plan header per mode', () => {
  it('shows Start and Simulate for a car trip, and the mode bar above the destination', async () => {
    await plan();
    render(<PlanSheet />);
    expect(screen.getByRole('button', { name: /^Start/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Simulate/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Travel mode' })).toBeInTheDocument();
  });

  it('a flight says it is an estimate and a plan only: no Start, no Simulate', async () => {
    useAppStore.getState().setTravelMode('flight');
    await plan();
    render(<PlanSheet />);
    expect(screen.getByText(/Straight-line estimate/)).toBeInTheDocument();
    expect(screen.getByText(/A flight is a plan only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Simulate/ })).toBeNull();
  });
});

describe('public transport', () => {
  it('shows the trips found: times, the lines to take, each step — a plan, with the timetables credited', async () => {
    useAppStore.getState().setTravelMode('transit');
    await plan();
    useAppStore.getState().setSheet('expanded'); // the steps and data sources are in the pulled-up sheet
    render(<PlanSheet />);
    const options = screen.getAllByRole('radio').filter((r) => r.className.includes('ropt'));
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(options[0].textContent).toMatch(/871/);
    expect(options[0].textContent).toMatch(/from Tbilisi Central/);
    expect(options[0].textContent).toMatch(/no transfers/);
    expect(options[1].textContent).toMatch(/873/);
    // Step by step: walk, board, ride, get off.
    expect(screen.getByText('Step by step')).toBeInTheDocument();
    expect(screen.getByText(/towards Batumi/)).toBeInTheDocument();
    expect(screen.getByText(/2 stops/)).toBeInTheDocument();
    // A plan only, and the timetable sources are linked (Transitous' terms).
    expect(screen.getByText(/public-transport trip is a plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Transitous/ })).toHaveAttribute('href', 'https://transitous.org/sources/');
    // No "when to leave" comparison: leaving later is another trip on the timetable.
    expect(screen.queryByText('When to leave')).toBeNull();
  });

  it('when nothing is found, says so plainly and offers timetables elsewhere (a link, opened only if tapped)', async () => {
    await plan();
    harness.transit.found = false;
    useAppStore.getState().setTravelMode('transit');
    await vi.waitFor(() => expect(useAppStore.getState().routeStatus).toBe('error'));
    render(<SearchPanel />);
    expect(screen.getByRole('alert').textContent).toMatch(/No public transport found/);
    const link = screen.getByRole('link', { name: 'Check timetables in Google Maps' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    const url = new URL(link.getAttribute('href')!);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('travelmode')).toBe('transit');
    expect(url.searchParams.get('destination')).toBe('Batumi, Georgia');
  });

  it('does not send "Your location" to Google as text — it leaves the start out', () => {
    const here = { text: 'Your location', place: { id: 'h', name: 'Your location', label: 'Your location', coordinate: [1, 2] as [number, number], kind: 'here' } };
    const dest = { text: 'Batumi', place: null };
    const u = new URL(transitTimetablesUrl(here, dest));
    expect(u.searchParams.has('origin')).toBe(false);
    expect(u.searchParams.get('destination')).toBe('Batumi');
    // A typed start is passed on as typed.
    expect(new URL(transitTimetablesUrl({ text: ' Tbilisi ', place: null }, dest)).searchParams.get('origin')).toBe('Tbilisi');
  });
});

