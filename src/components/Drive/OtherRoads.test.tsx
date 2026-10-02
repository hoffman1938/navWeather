import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../../services/providers';
import { useSettings } from '../../state/settings';
import { __resetStoreRuntime, useAppStore } from '../../state/store';
import { installFakeProviders, type Harness } from '../../test/harness';
import { tbilisiBatumiDetour } from '../../test/helpers';
import { respond, __resetAssistant } from '../../voice/assistant';
import { OtherRoads } from './OtherRoads';

const BASE = Date.UTC(2026, 8, 26, 4, 0); // 08:00 in Tbilisi
const initial = useAppStore.getState();
let h: Harness;

/** A simulated drive ≈ 12 % of the way — still before the fork of the northern road (at 30 %). */
async function drivingBeforeTheFork() {
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
  useAppStore.getState().setSimulationSpeed(60);
  useAppStore.getState().startSimulation();
  for (let k = 0; k < 60; k++) useAppStore.getState().advanceSimulationBy(500);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  __resetAssistant();
  useAppStore.setState(initial, true);
  useSettings.getState().reset();
  useSettings.getState().update({ language: 'en', units: { distance: 'metric', temperature: 'c', wind: 'kmh' } });
  h = installFakeProviders(BASE);
  h.weather.hourFn = (lat, _lon, hourMs) => {
    const raining = lat > 42.4 && hourMs - BASE >= 3600_000;
    return { temperature: 18, code: raining ? 63 : 1, precipitation: raining ? 1.5 : 0, precipitationProbability: raining ? 80 : 5 };
  };
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('<OtherRoads> while driving', () => {
  it('shows nothing when there is no other road to take', async () => {
    await drivingBeforeTheFork();
    const { container } = render(<OtherRoads />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the other road with how it differs, its forecast and a way to take it', async () => {
    h.alternativeRoads.push(tbilisiBatumiDetour(0.3, 0.7, 0.5, 1.15));
    await drivingBeforeTheFork();
    render(<OtherRoads />);

    const section = screen.getByRole('region', { name: 'Other roads' });
    expect(section.querySelector('.oroad__meta')!.textContent).toMatch(/^\d+ h \d+ min · \d+ km · \d+ (h \d+ )?min longer$/);
    const forecast = within(section).getByRole('group', { name: /Forecast along this road/ });
    expect(within(forecast).getAllByText('18°').length).toBeGreaterThanOrEqual(2);
    expect(within(forecast).getByText('Batumi')).toBeInTheDocument();
    // The northern road runs into rain, which the list says in minutes.
    expect(within(section).getByText(/min in rain/)).toBeInTheDocument();
    expect(section.querySelector('.rfc__seg[data-wx="rain"]')).not.toBeNull();
  });

  it('"Take this road" carries the drive on along it', async () => {
    h.alternativeRoads.push(tbilisiBatumiDetour(0.3, 0.7, 0.5, 1.15));
    await drivingBeforeTheFork();
    render(<OtherRoads />);
    const other = useAppStore.getState().routeOptions[1];
    screen.getByRole('button', { name: 'Take this road' }).click();
    expect(useAppStore.getState().plan!.timed).toBe(other.timed);
    expect(useAppStore.getState().mode).toBe('simulating');
  });
});

describe('"show another route" while driving', () => {
  it('opens the other roads when there are some', async () => {
    h.alternativeRoads.push(tbilisiBatumiDetour(0.3, 0.7, 0.5, 1.15));
    await drivingBeforeTheFork();
    useAppStore.getState().setSheet('compact');
    expect(await respond('Show another route')).toBe('Here are the route options.');
    expect(useAppStore.getState().sheet).toBe('expanded');
  });

  it('says so when there is none', async () => {
    await drivingBeforeTheFork();
    expect(await respond('Show another route')).toBe('No alternative route is available right now.');
  });
});
