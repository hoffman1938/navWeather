import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../../services/providers';
import { useSettings } from '../../state/settings';
import { __resetStoreRuntime, useAppStore } from '../../state/store';
import { installFakeProviders } from '../../test/harness';
import { SettingsDialog } from './SettingsDialog';

const BASE = Date.UTC(2026, 8, 26, 4, 0);
const initial = useAppStore.getState();

beforeEach(() => {
  __resetStoreRuntime();
  useAppStore.setState(initial, true);
  useSettings.getState().reset();
  useSettings.getState().update({ language: 'en' });
  installFakeProviders(BASE);
  useAppStore.getState().setSettingsOpen(true);
});

afterEach(() => {
  setProviders(null);
  vi.restoreAllMocks();
});

const group = (name: string) => screen.getByRole('radiogroup', { name });

describe('<SettingsDialog>', () => {
  it('is grouped into titled sections', () => {
    render(<SettingsDialog />);
    for (const title of ['Display', 'Voice', 'Weather alerts', 'Driving and safety', 'Saved places']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('short choices are segmented controls with every option in view', () => {
    render(<SettingsDialog />);
    expect(within(group('Units')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Kilometers', 'Miles']);
    expect(within(group('Temperature')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['°C', '°F']);
    expect(within(group('Appearance')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Same as device', 'Light', 'Dark', 'Day and night']);
  });

  it('the app\'s look is the device\'s by default, and each choice is kept', async () => {
    render(<SettingsDialog />);
    const appearance = group('Appearance');
    expect(within(appearance).getByRole('radio', { name: 'Same as device' })).toHaveAttribute('aria-checked', 'true');
    within(appearance).getByRole('radio', { name: 'Dark' }).click();
    expect(useSettings.getState().theme).toBe('dark');
    await vi.waitFor(() => expect(within(group('Appearance')).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true'));
    within(group('Appearance')).getByRole('radio', { name: 'Day and night' }).click();
    expect(useSettings.getState().theme).toBe('sun');
  });

  it('units change when tapped', async () => {
    render(<SettingsDialog />);
    within(group('Units')).getByRole('radio', { name: 'Miles' }).click();
    await vi.waitFor(() => expect(within(group('Units')).getByRole('radio', { name: 'Miles' })).toHaveAttribute('aria-checked', 'true'));
    within(group('Temperature')).getByRole('radio', { name: '°F' }).click();
    expect(useSettings.getState().units).toMatchObject({ distance: 'imperial', temperature: 'f' });
  });

  it('speed camera alerts are on by default, and the setting says where they may be used', () => {
    render(<SettingsDialog />);
    const sw = screen.getByRole('switch', { name: /Speed camera alerts/ });
    expect(sw).toBeChecked();
    expect(screen.getByText(/Use only where it is legal/)).toBeInTheDocument();
    sw.click();
    expect(useSettings.getState()).toMatchObject({ speedCameras: false, speedCamerasChosen: true });
  });

  it('weather alert types are toggle chips', async () => {
    render(<SettingsDialog />);
    const rain = screen.getByRole('button', { name: 'Rain' });
    expect(rain).toHaveAttribute('aria-pressed', 'true');
    rain.click();
    expect(useSettings.getState().weatherAlerts.types.rain).toBe(false);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Rain' })).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByRole('button', { name: 'Snow and ice' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Done closes it', () => {
    render(<SettingsDialog />);
    screen.getByRole('button', { name: 'Done' }).click();
    expect(useAppStore.getState().settingsOpen).toBe(false);
  });
});
