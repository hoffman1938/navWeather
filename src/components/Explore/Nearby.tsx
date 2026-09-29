import { formatDistance } from '../../i18n/format';
import { chargingSummary } from '../../services/places/evCharging';
import type { Poi, PoiCategory } from '../../services/places/PoiProvider';
import { getProviders } from '../../services/providers';
import { useExplore } from '../../state/explore';
import { useMessages, useSettings } from '../../state/settings';
import { haversineM } from '../../utils/distance';
import { BottomSheet } from '../BottomSheet/BottomSheet';
import { CloseIcon, SearchIcon } from '../Icons/Icons';

/** The categories people look for from a map most often. */
export const QUICK_CATEGORIES: PoiCategory[] = ['fuel', 'cafe', 'restaurant', 'ev_charging', 'hotel', 'pharmacy', 'supermarket', 'parking'];

/** EV chargers: "CCS2 · Type 2 ×2 · up to 150 kW", or that nothing is mapped. */
export function chargingLine(poi: Poi, m: ReturnType<typeof useMessages>): string | null {
  if (poi.category !== 'ev_charging') return null;
  return poi.charging ? chargingSummary(poi.charging, m.poi.chargingUpTo) : m.poi.connectorsUnknown;
}

/** One-tap category search under the search bar (explore mode). */
export function NearbyChips() {
  const m = useMessages();
  const active = useExplore((s) => s.nearby?.category ?? null);
  if (!getProviders().poi?.searchNear) return null;
  return (
    <div className="nearby-chips" role="toolbar" aria-label={m.explore.nearbyLabel}>
      {QUICK_CATEGORIES.map((c) => (
        <button
          key={c}
          className={`nearby-chip${active === c ? ' is-on' : ''}`}
          aria-pressed={active === c}
          onClick={() => (active === c ? useExplore.getState().clearNearby() : void useExplore.getState().searchNearby(c))}
        >
          {m.poi.categoryPlural[c]}
        </button>
      ))}
    </div>
  );
}

/** Results list: nearest first; tap for the place card (weather, drive time, directions). */
export function NearbySheet() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const nearby = useExplore((s) => s.nearby);
  const view = useExplore((s) => s.view);
  if (!nearby) return null;
  const moved = view ? haversineM(view.center, nearby.center) > nearby.radiusM * 0.6 : false;
  const title = m.explore.nearbyTitle(m.poi.categoryPlural[nearby.category]);
  return (
    <BottomSheet
      state="default"
      onChange={() => undefined}
      grabber={false}
      label={title}
      header={
        <div className="phead">
          <div className="phead__text">
            <h2 className="phead__title">{title}</h2>
            {nearby.status === 'ready' ? <p className="phead__meta">{m.explore.nearbyWithin(formatDistance(nearby.radiusM, units, m))}</p> : null}
          </div>
          <button className="icon-btn phead__close" onClick={() => useExplore.getState().clearNearby()} aria-label={m.ui.close}>
            <CloseIcon size={20} />
          </button>
          {moved && nearby.status !== 'loading' ? (
            <div className="phead__actions">
              <button className="btn btn-quiet" onClick={() => void useExplore.getState().searchNearby(nearby.category)}>
                <SearchIcon size={18} />
                {m.explore.searchThisArea}
              </button>
            </div>
          ) : null}
        </div>
      }
      body={
        nearby.status === 'loading' ? (
          <p className="pw-status" role="status">
            <span className="spinner" aria-hidden="true" />
            {m.poi.searching}
          </p>
        ) : nearby.status === 'error' ? (
          <p className="pw-status">{m.poi.unavailable}</p>
        ) : nearby.results.length === 0 ? (
          <p className="pw-status">{m.explore.nearbyNone}</p>
        ) : (
          <ul className="rows nearby-list">
            {nearby.results.map((r) => {
              const name = r.poi.name ?? r.poi.brand ?? m.poi.unnamed(m.poi.category[r.poi.category]);
              const sub = [r.poi.brand && r.poi.brand !== name ? r.poi.brand : null, chargingLine(r.poi, m)].filter(Boolean).join(' · ');
              return (
                <li key={r.poi.id}>
                  <button className="nearby-row" onClick={() => useExplore.getState().openPoi(r.poi)}>
                    <span className="nearby-row__text">
                      <span className="nearby-row__name">{name}</span>
                      {sub ? <span className="nearby-row__sub">{sub}</span> : null}
                    </span>
                    <span className="nearby-row__dist tabular">{formatDistance(r.distanceM, units, m)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      }
    />
  );
}
