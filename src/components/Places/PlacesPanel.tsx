import { formatDistance } from '../../i18n/format';
import type { PoiCategory } from '../../services/places/PoiProvider';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { getProviders } from '../../services/providers';
import { chargingLine } from '../Explore/Nearby';
import './Places.css';

const QUICK: PoiCategory[] = ['fuel', 'ev_charging', 'restaurant', 'cafe', 'hotel', 'parking', 'rest_area', 'pharmacy', 'hospital'];

/**
 * "Places along my route" — results are ahead of you, with the real detour
 * (extra driving time), not a radius around your position.
 */
export function PlacesPanel() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const poi = useAppStore((s) => s.poi);
  if (!getProviders().poi) return null;
  return (
    <section className="places" aria-label={m.ui.findAlongRoute}>
      <h3 className="label">{m.ui.findAlongRoute}</h3>
      <div className="places__cats" role="group">
        {QUICK.map((c) => (
          <button
            key={c}
            className={`places__cat${poi?.category === c ? ' is-active' : ''}`}
            aria-pressed={poi?.category === c}
            onClick={() => void useAppStore.getState().searchPoi(c)}
          >
            {m.poi.categoryPlural[c]}
          </button>
        ))}
      </div>
      {poi?.status === 'loading' ? (
        <p className="places__status" role="status">
          <span className="spinner" aria-hidden="true" /> {m.poi.searching}
        </p>
      ) : null}
      {poi?.status === 'error' ? <p className="places__status">{m.poi.unavailable}</p> : null}
      {poi?.status === 'ready' && poi.results.length === 0 ? <p className="places__status">{m.poi.none}</p> : null}
      {poi?.status === 'ready' && poi.results.length ? (
        <ul className="rows">
          {poi.results.map((r) => {
            const name = r.poi.name ?? r.poi.brand ?? m.poi.unnamed(m.poi.category[r.poi.category]);
            const detourMin = r.detourS !== undefined ? Math.round(r.detourS / 60) : null;
            return (
              <li key={r.poi.id} className="place">
                <span className="place__main">
                  <span className="place__name">{name}</span>
                  <span className="place__meta tabular">
                    {m.poi.ahead(formatDistance(r.aheadM, units, m))} ·{' '}
                    {r.offRouteM < 150 ? m.poi.onRoute : m.poi.offRoute(formatDistance(r.offRouteM, units, m))}
                  </span>
                  {r.poi.category === 'ev_charging' ? <span className="place__meta">{chargingLine(r.poi, m)}</span> : null}
                </span>
                {detourMin !== null ? <span className="place__detour tabular">{m.poi.detourMin(detourMin)}</span> : null}
                <button
                  className="btn btn-quiet"
                  onClick={() =>
                    void useAppStore.getState().addStop({
                      id: r.poi.id,
                      name,
                      label: name,
                      coordinate: r.poi.coordinate,
                      kind: r.poi.category,
                    })
                  }
                >
                  {m.poi.addStop}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
