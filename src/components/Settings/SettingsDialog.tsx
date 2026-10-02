import { useEffect, useId, useState, type ReactNode } from 'react';
import { LOCALES, type Locale } from '../../i18n';
import { googleVoicesFor } from '../../voice/voices';
import { useMessages, useSettings, type Settings } from '../../state/settings';
import { loadDriveExtras, useAppStore } from '../../state/store';
import { useSavedPlaces } from '../../state/savedPlaces';
import { Dialog } from '../Common/Dialog';
import { CloseIcon, SpeakerIcon } from '../Icons/Icons';
import { getProviders } from '../../services/providers';
import './Settings.css';

/** A titled group of settings, as one card. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <h3 className="set-title">{title}</h3>
      <div className="set-card">{children}</div>
    </section>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <label className="set-row">
      <span className="set-row__label">{label}</span>
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

/** A few short choices side by side — one tap, everything visible (instead of a dropdown). */
function Segmented<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: [T, string][]; onChange(v: T): void; hint?: string }) {
  const id = useId();
  return (
    <div className={`set-row set-row--seg${hint ? ' set-row--stack' : ''}`}>
      <span className="set-row__label">
        <span id={id}>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      <div className="seg" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} className={`seg__opt${v === value ? ' is-on' : ''}`} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="set-row set-row--chips">
      <span className="set-row__label" id={id}>
        {label}
      </span>
      <div className="chips" role="group" aria-labelledby={id}>
        {children}
      </div>
    </div>
  );
}

function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="set-row set-row--switch">
      <span className="set-row__label">
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
  const typeChips: [keyof typeof types, string][] = [
    ['rain', S.typeRain],
    ['snow', S.typeSnow],
    ['fog', S.typeFog],
    ['wind', S.typeWind],
    ['temperature', S.typeTemperature],
  ];

  return (
    <Dialog label={S.title} onClose={close} size="large">
      <div className="set-head">
        <h2>{S.title}</h2>
        <button className="icon-btn" onClick={close} aria-label={m.ui.close}>
          <CloseIcon size={20} />
        </button>
      </div>

      <Section title={S.sectionDisplay}>
        <Select<Locale> label={S.language} value={s.language} options={LOCALES.map((l) => [l.id, l.name])} onChange={(language) => up({ language })} />
        <Segmented
          label={S.units}
          value={s.units.distance}
          options={[
            ['metric', S.metric],
            ['imperial', S.imperial],
          ]}
          onChange={(distance) => up({ units: { ...s.units, distance } })}
        />
        <Segmented
          label={S.temperature}
          value={s.units.temperature}
          options={[
            ['c', '°C'],
            ['f', '°F'],
          ]}
          onChange={(temperature) => up({ units: { ...s.units, temperature } })}
        />
        <Segmented
          label={S.wind}
          value={s.units.wind}
          options={[
            ['kmh', m.units.kmh],
            ['mph', m.units.mph],
            ['ms', m.units.ms],
          ]}
          onChange={(wind) => up({ units: { ...s.units, wind } })}
        />
        <Segmented
          label={S.theme}
          value={s.theme}
          hint={S.themeHint}
          options={[
            ['auto', S.themeAuto],
            ['light', S.themeLight],
            ['dark', S.themeDark],
            ['sun', S.themeSun],
          ]}
          onChange={(theme) => up({ theme })}
        />
      </Section>

      <Section title={S.sectionVoice}>
        <Switch label={S.voiceGuidance} checked={s.voice} onChange={(voice) => up({ voice })} hint={S.voiceRecognitionNote} />
        {s.voice ? <VoiceSettings /> : null}
      </Section>

      <Section title={S.weatherAlerts}>
        <Segmented
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
        <Segmented
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
        <Chips label={S.alertTypes}>
          {typeChips.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={types[k]} className={`chip${types[k] ? ' is-on' : ''}`} onClick={() => setType(k, !types[k])}>
              {label}
            </button>
          ))}
        </Chips>
      </Section>

      <Section title={S.sectionDriving}>
        <Switch label={S.speedWarnings} checked={s.speedWarnings} onChange={(speedWarnings) => up({ speedWarnings })} hint={m.ui.speedLimitNote} />
        <Switch label={S.speedCameras} checked={s.speedCameras} onChange={(speedCameras) => up({ speedCameras })} hint={S.speedCamerasHint} />
        <Switch label={S.roadHazards} checked={s.roadHazards} onChange={(roadHazards) => up({ roadHazards })} hint={S.roadHazardsHint} />
        <Switch label={S.breakReminders} checked={s.breakReminders} onChange={(breakReminders) => up({ breakReminders })} hint={S.breakRemindersHint} />
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
        <Segmented
          label={S.vehicle}
          value={s.vehicle}
          options={[
            ['fuel', S.vehicleFuel],
            ['ev', S.vehicleEv],
          ]}
          onChange={(vehicle) => up({ vehicle })}
        />
        <label className="set-row">
          <span className="set-row__label">
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
      </Section>

      <TripSettings />

      <SavedPlacesSettings />

      <p className="set-note set-privacy">{S.privacy}</p>
      <div className="set-foot">
        <button className="btn btn-primary set-done" onClick={close}>
          {S.done}
        </button>
      </div>
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
      <div className="set-row set-row--note">
        <p className="set-note">{!voices.length ? S.noGoogleVoice : S.voiceGoogleNote}</p>
        <button className="btn btn-quiet set-sample" onClick={() => getProviders().tts.preview?.(S.voiceSampleText, m.speechLang, known ? saved : 'auto')}>
          <SpeakerIcon size={18} />
          {S.voiceSample}
        </button>
      </div>
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
    <Section title={S.savedPlaces}>
      {saved.length ? (
        saved.map((p) => (
          <div className="set-row set-saved" key={`${p.slot}:${p.id}`}>
            <span className="set-row__label set-saved__name">{label(p.slot, p.name)}</span>
            <button className="btn btn-quiet" onClick={() => useSavedPlaces.getState().remove(p.id, p.slot)}>
              {S.remove}
            </button>
          </div>
        ))
      ) : (
        <div className="set-row set-row--note">
          <p className="set-note">{S.noSaved}</p>
        </div>
      )}
      <Switch label={S.rememberRecents} checked={remember} onChange={(on) => useSavedPlaces.getState().setRememberRecents(on)} hint={S.rememberRecentsHint} />
      {recents ? (
        <div className="set-row set-row--note">
          <button className="btn btn-quiet" onClick={() => useSavedPlaces.getState().clearRecents()}>
            {S.clearRecents}
          </button>
        </div>
      ) : null}
    </Section>
  );
}

/** Long trips: pace, vehicle, tank and consumption, and what to recommend (docs/features/LONG_TRIP_MODE.md). */
function TripSettings() {
  const m = useMessages();
  const T = m.trip.settings;
  const s = useSettings();
  const up = s.update;
  const num = (v: string): number | null => {
    const n = v === '' ? null : Number(v);
    return n === null || !Number.isFinite(n) || n <= 0 ? null : n;
  };
  return (
    <Section title={T.section}>
      <Segmented
        label={T.pace}
        value={s.tripPace}
        options={[
          ['relaxed', T.relaxed],
          ['balanced', T.balanced],
          ['fast', T.fast],
        ]}
        onChange={(tripPace) => up({ tripPace })}
        hint={T.paceHint}
      />
      <Select
        label={T.vehicleKind}
        value={s.vehicleKind}
        options={[
          ['car', T.car],
          ['van', T.van],
          ['truck', T.truck],
          ['motorcycle', T.motorcycle],
        ]}
        onChange={(vehicleKind) => up({ vehicleKind })}
      />
      {s.vehicleKind === 'truck' ? <p className="set-note">{T.truckNote}</p> : null}
      <label className="set-row">
        <span className="set-row__label">
          {T.tank}
          <small>{T.tankHint}</small>
        </span>
        <input type="number" inputMode="decimal" min={0} max={1000} value={s.tankSize ?? ''} onChange={(e) => up({ tankSize: num(e.target.value) })} />
      </label>
      <label className="set-row">
        <span className="set-row__label">{T.consumption}</span>
        <input type="number" inputMode="decimal" min={0} max={100} step="0.1" value={s.consumptionPer100Km ?? ''} onChange={(e) => up({ consumptionPer100Km: num(e.target.value) })} />
      </label>
      <Segmented
        label={T.stars}
        value={String(s.hotelMinStars) as '0' | '3' | '4'}
        options={[
          ['0', T.starsAny],
          ['3', T.stars3],
          ['4', T.stars4],
        ]}
        onChange={(v) => up({ hotelMinStars: Number(v) as 0 | 3 | 4 })}
      />
      <Segmented
        label={T.detour}
        value={String(s.hotelMaxDetourKm) as '5' | '10' | '20'}
        options={[
          ['5', s.units.distance === 'imperial' ? '3 mi' : '5 km'],
          ['10', s.units.distance === 'imperial' ? '6 mi' : '10 km'],
          ['20', s.units.distance === 'imperial' ? '12 mi' : '20 km'],
        ]}
        onChange={(v) => up({ hotelMaxDetourKm: Number(v) as 5 | 10 | 20 })}
      />
      <Select
        label={T.food}
        value={s.tripFood}
        options={[
          ['any', T.foodAny],
          ['restaurant', T.restaurant],
          ['fast_food', T.fastFood],
          ['cafe', T.cafe],
        ]}
        onChange={(tripFood) => up({ tripFood })}
      />
      <label className="set-row">
        <span className="set-row__label">{T.fuelBrand}</span>
        <input type="text" maxLength={40} value={s.fuelBrand ?? ''} onChange={(e) => up({ fuelBrand: e.target.value.trim() ? e.target.value : null })} />
      </label>
    </Section>
  );
}
