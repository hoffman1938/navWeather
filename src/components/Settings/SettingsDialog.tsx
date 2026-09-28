import { LOCALES, type Locale } from '../../i18n';
import { useMessages, useSettings, type Settings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { useSavedPlaces } from '../../state/savedPlaces';
import { Dialog } from '../Common/Dialog';
import './Settings.css';

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <label className="set-row">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="set-row set-row--switch">
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Settings — only preferences, stored on this device. */
export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const m = useMessages();
  const s = useSettings();
  if (!open) return null;
  const S = m.settings;
  const close = () => useAppStore.getState().setSettingsOpen(false);
  const up = (patch: Partial<Settings>) => {
    s.update(patch);
    useAppStore.getState().rederive();
  };
  const types = s.weatherAlerts.types;
  const setType = (k: keyof typeof types, v: boolean) => up({ weatherAlerts: { ...s.weatherAlerts, types: { ...types, [k]: v } } });

  return (
    <Dialog label={S.title} onClose={close} size="large">
      <h2>{S.title}</h2>
      <div className="set-group">
        <Select<Locale> label={S.language} value={s.language} options={LOCALES.map((l) => [l.id, l.name])} onChange={(language) => up({ language })} />
        <Select
          label={S.units}
          value={s.units.distance}
          options={[
            ['metric', S.metric],
            ['imperial', S.imperial],
          ]}
          onChange={(distance) => up({ units: { ...s.units, distance } })}
        />
        <Select
          label={S.temperature}
          value={s.units.temperature}
          options={[
            ['c', '°C'],
            ['f', '°F'],
          ]}
          onChange={(temperature) => up({ units: { ...s.units, temperature } })}
        />
        <Select
          label={S.wind}
          value={s.units.wind}
          options={[
            ['kmh', m.units.kmh],
            ['mph', m.units.mph],
            ['ms', m.units.ms],
          ]}
          onChange={(wind) => up({ units: { ...s.units, wind } })}
        />
        <Select
          label={S.theme}
          value={s.theme}
          options={[
            ['auto', S.themeAuto],
            ['light', S.themeLight],
            ['dark', S.themeDark],
          ]}
          onChange={(theme) => up({ theme })}
        />
      </div>

      <div className="set-group">
        <Switch label={S.voiceGuidance} checked={s.voice} onChange={(voice) => up({ voice })} hint={S.voiceRecognitionNote} />
      </div>

      <div className="set-group">
        <h3 className="label">{S.weatherAlerts}</h3>
        <Select
          label={S.alertOutput}
          value={s.alertOutput}
          options={[
            ['both', S.outputBoth],
            ['visual', S.outputVisual],
            ['voice', S.outputVoice],
            ['off', S.outputOff],
          ]}
          onChange={(alertOutput) => up({ alertOutput })}
        />
        <Select
          label={S.alertLevel}
          value={s.weatherAlerts.level}
          options={[
            ['all', S.levelAll],
            ['severe', S.levelSevere],
          ]}
          onChange={(level) => up({ weatherAlerts: { ...s.weatherAlerts, level } })}
        />
        <Select
          label={S.timing}
          value={s.alertTiming}
          options={[
            ['auto', S.timingAuto],
            ['early', S.timingEarly],
            ['standard', S.timingStandard],
            ['minimal', S.timingMinimal],
          ]}
          onChange={(alertTiming) => up({ alertTiming })}
        />
        <Switch label={S.typeRain} checked={types.rain} onChange={(v) => setType('rain', v)} />
        <Switch label={S.typeSnow} checked={types.snow} onChange={(v) => setType('snow', v)} />
        <Switch label={S.typeFog} checked={types.fog} onChange={(v) => setType('fog', v)} />
        <Switch label={S.typeWind} checked={types.wind} onChange={(v) => setType('wind', v)} />
        <Switch label={S.typeTemperature} checked={types.temperature} onChange={(v) => setType('temperature', v)} />
      </div>

      <div className="set-group">
        <Switch label={S.speedWarnings} checked={s.speedWarnings} onChange={(speedWarnings) => up({ speedWarnings })} hint={m.ui.speedLimitNote} />
        <Switch label={S.breakReminders} checked={s.breakReminders} onChange={(breakReminders) => up({ breakReminders })} hint={S.breakRemindersHint} />
        <Switch label={S.speedCameras} checked={s.speedCameras} onChange={(speedCameras) => up({ speedCameras })} hint={S.speedCamerasHint} />
        <Switch label={S.batterySaver} checked={s.batterySaver} onChange={(batterySaver) => up({ batterySaver })} hint={S.batterySaverHint} />
        <Select
          label={S.vehicle}
          value={s.vehicle}
          options={[
            ['fuel', S.vehicleFuel],
            ['ev', S.vehicleEv],
          ]}
          onChange={(vehicle) => up({ vehicle })}
        />
        <label className="set-row">
          <span>
            {S.fuelRange}
            <small>{S.fuelRangeHint}</small>
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={2000}
            value={s.fuelRangeKm === null ? '' : s.units.distance === 'imperial' ? Math.round(s.fuelRangeKm / 1.609344) : s.fuelRangeKm}
            placeholder={s.units.distance === 'imperial' ? m.units.mi : m.units.km}
            onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              up({ fuelRangeKm: v === null || !Number.isFinite(v) || v <= 0 ? null : s.units.distance === 'imperial' ? v * 1.609344 : v });
            }}
          />
        </label>
      </div>

      <SavedPlacesSettings />

      <p className="set-note">{S.privacy}</p>
      <button className="btn btn-primary set-done" onClick={close}>
        {S.done}
      </button>
    </Dialog>
  );
}

function SavedPlacesSettings() {
  const m = useMessages();
  const S = m.settings;
  const saved = useSavedPlaces((st) => st.saved);
  const recents = useSavedPlaces((st) => st.recents.length);
  const remember = useSavedPlaces((st) => st.rememberRecents);
  const label = (slot: string, name: string) =>
    slot === 'home' ? `${m.explore.home} · ${name}` : slot === 'work' ? `${m.explore.work} · ${name}` : slot === 'parking' ? m.parking.title : name;
  return (
    <div className="set-group">
      <h3 className="label">{S.savedPlaces}</h3>
      {saved.length ? (
        <ul className="rows set-saved">
          {saved.map((p) => (
            <li key={`${p.slot}:${p.id}`}>
              <span>{label(p.slot, p.name)}</span>
              <button className="btn btn-quiet" onClick={() => useSavedPlaces.getState().remove(p.id, p.slot)}>
                {S.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="set-note">{S.noSaved}</p>
      )}
      <Switch label={S.rememberRecents} checked={remember} onChange={(on) => useSavedPlaces.getState().setRememberRecents(on)} hint={S.rememberRecentsHint} />
      {recents ? (
        <button className="btn btn-quiet set-clear" onClick={() => useSavedPlaces.getState().clearRecents()}>
          {S.clearRecents}
        </button>
      ) : null}
    </div>
  );
}
