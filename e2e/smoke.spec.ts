import { expect, test, type Request } from '@playwright/test';

/**
 * The app end to end (DEVELOPMENT_PLAN DP-2.6, gate G4): search → a road with its weather → a simulated drive →
 * live sharing (and its viewer) → a driver report while really driving. Same suite on localhost and on preview.
 *
 * E2E_STRICT=1 (localhost with `npm run seed:local`, `data:weather`, `engines:up`; preview with its data) also
 * checks that nothing went to the public services with usage limits — our own API answered everything
 * (elevation and air quality excepted until DP-4.6/4.7).
 *
 * The basemap (OpenFreeMap style and tiles) is not loaded unless E2E_MAP=1: in headless Chrome every map frame
 * waits on a GPU process that has no display, and the page stalls for about a minute after the map appears. The
 * flows under test don't need the picture; the map itself is checked by eye and by its own unit tests.
 */

const STRICT = process.env.E2E_STRICT === '1';
const LIMITED_HOSTS = ['router.project-osrm.org', 'routing.openstreetmap.de', 'photon.komoot.io', 'nominatim.openstreetmap.org', 'overpass-api.de', 'overpass.kumi.systems'];
const limitedUrl = (u: URL) => LIMITED_HOSTS.includes(u.host) || (u.host === 'api.open-meteo.com' && u.pathname === '/v1/forecast');
// Where the example road starts (Tbilisi, our geocoder's city point).
const TBILISI = { latitude: 41.6936, longitude: 44.8014, accuracy: 8 };

test('search → road with weather → simulated drive → live share → driver report', async ({ page, context }) => {
  const limited: string[] = [];
  const watch = (r: Request) => {
    const u = new URL(r.url());
    if (limitedUrl(u)) limited.push(`${u.host}${u.pathname}?${[...u.searchParams.keys()].join('&')} (${u.searchParams.get('latitude')?.slice(0, 60) ?? ''})`);
  };
  context.on('request', watch);
  if (process.env.E2E_MAP !== '1') await context.route(/tiles\.openfreemap\.org/, (r) => r.abort());
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(TBILISI);

  await test.step('search answers from our geocoder', async () => {
    await page.goto('/');
    const search = page.getByRole('combobox', { name: 'Search a place or address' });
    const answer = page.waitForResponse((r) => r.url().includes('/api/v1/geocode') && r.request().method() === 'GET');
    await search.fill('Kutaisi');
    expect((await answer).ok()).toBe(true);
    await expect(page.getByRole('option', { name: /Kutaisi/ }).first()).toBeVisible();
    await search.fill('');
    await page.keyboard.press('Escape');
  });

  await test.step('a road with the weather along it', async () => {
    const forecast = page.waitForResponse((r) => r.url().includes('/api/v1/weather/forecast'));
    await page.getByRole('button', { name: 'Try Tbilisi → Batumi' }).click();
    await expect(page.getByText(/\d{3}\s?km\b/).first()).toBeVisible();
    const f = await forecast;
    if (STRICT) expect(f.status()).toBe(200);
    // The weather at each place on the way, at the time we get there.
    await expect(page.getByText('ETA').first()).toBeVisible();
  });

  await test.step('a simulated drive, shared live, seen by a viewer', async () => {
    await page.getByRole('button', { name: 'Simulate drive' }).click();
    await expect(page.getByRole('button', { name: 'Exit simulation' })).toBeVisible();
    await page.getByRole('button', { name: 'Share trip progress' }).click();
    await page.getByPlaceholder('Shown to people with the link').fill('E2E');
    const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/share') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create link' }).click();
    expect((await created).status()).toBe(201);
    // The link sits in a read-only field (labelled "Link") for copying.
    const linkBox = page.getByRole('textbox', { name: 'Link' });
    await expect(linkBox).toHaveValue(/\/live\/[A-Za-z0-9_-]{22}$/);
    const url = await linkBox.inputValue();

    const viewer = await context.newPage();
    await viewer.goto(url);
    await expect(viewer.getByText('E2E').first()).toBeVisible();
    await viewer.close();

    const stopped = page.waitForResponse((r) => /\/api\/v1\/share\/[A-Za-z0-9_-]+$/.test(r.url()) && r.request().method() === 'DELETE');
    await page.getByRole('dialog', { name: 'Share your live location' }).getByRole('button', { name: 'Stop sharing' }).click();
    expect((await stopped).ok()).toBe(true);
    await page.getByRole('button', { name: 'Exit simulation' }).click();
  });

  await test.step('a driver report while really driving', async () => {
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Report' })).toBeVisible();
    await page.getByRole('button', { name: 'Report' }).click();
    const sent = page.waitForResponse((r) => r.url().endsWith('/api/v1/reports') && r.request().method() === 'POST');
    await page.getByRole('button', { name: /Hazard on the road/ }).click();
    // 201 a new report; 200 when one is already there (a repeated run counts as a confirmation).
    expect([200, 201]).toContain((await sent).status());
    await expect(page.getByText(/hazard on the road reported/i)).toBeVisible();
  });

  if (STRICT) expect(limited, 'requests to public services with limits').toEqual([]);
});
