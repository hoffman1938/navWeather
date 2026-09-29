import { useEffect, useState } from 'react';
import { LOCALES, type Locale } from '../../i18n';
import { googleVoicesFor } from '../../voice/voices';
import { useMessages, useSettings, type Settings } from '../../state/settings';
import { loadDriveExtras, useAppStore } from '../../state/store';
import { useSavedPlaces } from '../../state/savedPlaces';
import { Dialog } from '../Common/Dialog';
import { CloseIcon, SpeakerIcon } from '../Icons/Icons';
import { getProviders } from '../../services/providers';
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
    // Switched on mid-drive: fetch what it needs now, not on the next drive.
    if (patch.speedWarnings || patch.speedCameras || patch.roadHazards) loadDriveExtras();
    useAppStore.getState().rederive();
  };
  const types = s.weatherAlerts.types;
  const setType = (k: keyof typeof types, v: boolean) => up({ weatherAlerts: { ...s.weatherAlerts, types: { ...types, [k]: v } } });

  return (
    <Dialog label={S.title} onClose={close} size="large">
      <div className="set-head">
        <h2>{S.title}</h2>
        <button className="icon-btn" onClick={close} aria-label={m.ui.close}>
          <CloseIcon size={20} />
        </button>
      </div>
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
        {s.voice ? <VoiceSettings /> : null}
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
        <Switch label={S.roadHazards} checked={s.roadHazards} onChange={(roadHazards) => up({ roadHazards })} hint={S.roadHazardsHint} />
        <Switch label={S.speedCameras} checked={s.speedCameras} onChange={(speedCameras) => up({ speedCameras })} hint={S.speedCamerasHint} />
        {getProviders().incidents.name === 'reports' ? (
          <Switch
            label={S.driverReports}
            checked={s.driverReports}
            onChange={(driverReports) => {
              up({ driverReports });
              const app = useAppStore.getState();
              // Off: forget the reports on screen now; on: fetch them for the current route.
              if (!driverReports) useAppStore.setState({ incidents: app.incidents.filter((i) => !i.reportId), reportPrompt: null, reportDialogOpen: false });
              else app.refreshIncidents();
              useAppStore.getState().rederive();
            }}
            hint={S.driverReportsHint}
          />
        ) : null}
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

/** The device's voices for a language (they load asynchronously in Chrome and Safari). */
function useGoogleVoices(lang: string): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const sync = () => setVoices(googleVoicesFor(window.speechSynthesis.getVoices(), lang));
    sync();
    window.speechSynthesis.addEventListener?.('voiceschanged', sync);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', sync);
  }, [lang]);
  return voices;
}

/** Which Google voice speaks: the best one for the language, or a specific one. */
function VoiceSettings() {
  const m = useMessages();
  const S = m.settings;
  const locale = useSettings((st) => st.language);
  const saved = useSettings((st) => st.voiceByLang[locale] ?? 'auto');
  const voices = useGoogleVoices(m.speechLang);
  const choose = (value: string) => {
    const st = useSettings.getState();
    st.update({ voiceByLang: { ...st.voiceByLang, [locale]: value } });
  };
  const options: [string, string][] = [['auto', S.voiceAuto], ...voices.map((v): [string, string] => [`device:${v.voiceURI}`, v.name])];
  const known = options.some(([v]) => v === saved);

  return (
    <>
      <Select label={S.voiceChoice} value={known ? saved : 'auto'} options={options} onChange={choose} />
      {!voices.length ? <p className="set-note">{S.noGoogleVoice}</p> : <p className="set-note">{S.voiceGoogleNote}</p>}
      <button className="btn btn-quiet set-sample" onClick={() => getProviders().tts.preview?.(S.voiceSampleText, m.speechLang, known ? saved : 'auto')}>
        <SpeakerIcon size={18} />
        {S.voiceSample}
      </button>
    </>
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
