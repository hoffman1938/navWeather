import type { ReportKind } from '../reports/protocol';
import type { PoiCategory } from '../services/places/PoiProvider';

export type Intent =
  | { type: 'weather_ahead' }
  | { type: 'rain_when' }
  | { type: 'weather_at'; place: string }
  | { type: 'eta' }
  | { type: 'distance_to'; place?: string }
  | { type: 'next_turn' }
  | { type: 'traffic' }
  | { type: 'find_poi'; category: PoiCategory; maxDetourMin?: number; near?: string }
  | { type: 'alternatives' }
  | { type: 'recalculate' }
  | { type: 'avoid'; what: 'tolls' | 'highways' | 'ferries' }
  | { type: 'stop_navigation' }
  | { type: 'where_am_i' }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'repeat' }
  | { type: 'report'; kind: ReportKind }
  | { type: 'unknown'; text: string };

export interface ParseContext {
  last?: Intent;
}

const POI_WORDS: [RegExp, PoiCategory][] = [
  [/\b(ev|electric)\b.*\b(charg\w*)|\bcharg(er|ing)\b|зарядк|დამტენ/, 'ev_charging'],
  [/\b(gas|petrol|fuel|filling)\b|\bgas station\b|заправк|бензин|ბენზინ|საწვავ/, 'fuel'],
  [/\b(restaurant|food|eat|dinner|lunch|breakfast)\b|ресторан|поесть|რესტორან|საჭმელ/, 'restaurant'],
  [/\b(cafe|café|coffee)\b|кафе|кофе|კაფე|ყავა/, 'cafe'],
  [/\b(hotel|motel|place to stay|sleep)\b|гостиниц|отел|სასტუმრო/, 'hotel'],
  [/\bpark(ing)?\b|парковк|პარკინგ/, 'parking'],
  [/\b(atm|cash machine|cash)\b|банкомат|ბანკომატ/, 'atm'],
  [/\b(pharmacy|drugstore|chemist)\b|аптек|აფთიაქ/, 'pharmacy'],
  [/\b(supermarket|grocery|groceries|shop)\b|супермаркет|магазин|სუპერმარკეტ|მაღაზი/, 'supermarket'],
  [/\b(rest area|rest stop|services)\b|зона отдыха|დასასვენებ/, 'rest_area'],
  [/\b(toilet|restroom|bathroom|wc)\b|туалет|ტუალეტ/, 'toilets'],
  [/\b(hospital|emergency room|er)\b|больниц|госпитал|საავადმყოფ/, 'hospital'],
  [/\bcar wash\b|автомойк|სამრეცხაო/, 'car_wash'],
  [/\b(repair|mechanic|garage|tyre|tire)\b|автосервис|шиномонтаж|ავტოსერვის/, 'car_repair'],
  [/\b(attraction|sight|sightseeing|viewpoint)\b|достопримечательн|ღირსშესანიშნ/, 'attraction'],
];

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[?!.,;:"“”«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words that mean "the destination" rather than a named place. */
const DEICTIC = /^(it|there|the destination|my destination|destination|we|that|туда|დანიშნულებამდე)$/;

function titleCase(s: string): string {
  return s.replace(/(^|\s|-)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

function place(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const p = raw
    .replace(/^(the )?(city of |town of )/, '')
    .replace(/\b(please|now|right now|today|tonight)\b/g, '')
    .trim();
  if (!p || DEICTIC.test(p)) return undefined;
  return titleCase(p);
}

/**
 * NAVIGATION COMMAND PARSER — utterance → intent. Pattern based (fast,
 * offline, predictable); a language-model parser can replace it behind the
 * same Intent type later.
 */
export function parseCommand(utterance: string, ctx: ParseContext = {}): Intent {
  const t = clean(utterance);
  if (!t) return { type: 'unknown', text: utterance };

  // Control first — they must always work.
  if (/\b(unmute|voice on|turn (the )?voice on|speak again)\b|включи голос|ხმა ჩართე/.test(t)) return { type: 'unmute' };
  if (/\b(mute|be quiet|quiet|silence|stop talking|voice off)\b|выключи голос|тише|ხმა გამორთე|გაჩუმდი/.test(t)) return { type: 'mute' };
  if (/\b(repeat|say (that|it) again|what did you say)\b|повтори|გაიმეორე/.test(t)) return { type: 'repeat' };
  if (
    /\b(stop|end|cancel|exit|finish)\b.*\b(navigation|navigating|route|guidance|trip)\b|^(stop|stop it)$|останови навигацию|заверши маршрут|ნავიგაცი.*შეწყვიტე|შეწყვიტე ნავიგაცია/.test(t)
  ) {
    return { type: 'stop_navigation' };
  }

  // Driver reports ("Report an accident") — before "traffic", which also knows the word "accident".
  // Only commands: "any accident reports?" / "есть сообщения о ДТП?" stay questions.
  const reportVerb = /^(please )?(report|flag|mark)\b|\b(i want to|let me|i'd like to|can you) (report|flag)\b|(?<![а-яё])(сообщи|сообщить|отметь|отметить)(?![а-яё])|შეატყობინე|მონიშნე/;
  if (reportVerb.test(t) && !/\?$/.test(utterance.trim())) {
    const kind: ReportKind | null = /\b(accident|crash|collision|wreck)\b|(?<![а-яё])(дтп|авари[яиюей])|ავარი/.test(t)
      ? 'accident'
      : /\b(clos(ed|ure)|blocked)\b|перекрыт|закрыт|დაკეტ|ჩაკეტ/.test(t)
        ? 'closure'
        : /\b(road ?works?|construction)\b|(?<![а-яё])ремонт|дорожн[а-яё]* работ|სამუშაო|შეკეთებ/.test(t)
          ? 'roadworks'
          : /\b(ice|icy|flood\w*|fog|snow\w*)\b|гололё?д|(?<![а-яё])(лё?д|туман|подтоп[а-яё]*|снег)|ყინ|ნისლ|დატბორ|თოვლ/.test(t)
            ? 'weather'
            : /\b(hazard|danger\w*|object|debris|obstacle|pothole|animal)\b|опасн|препятстви|(?<![а-яё])(предмет|ям[аеуы]|животн)|საფრთხ|დაბრკოლ|ორმო|ცხოველ/.test(t)
              ? 'hazard'
              : null;
    if (kind) return { type: 'report', kind };
  }

  // Route changes
  const avoid = /\bavoid\b.*\b(toll|highway|motorway|freeway|ferr)|без (платных|магистрал|паром)|ფასიანი გზ/.exec(t);
  if (avoid) {
    const w = avoid[1] ?? '';
    return { type: 'avoid', what: /toll|платн|ფასიან/.test(w + t) ? 'tolls' : /ferr|паром/.test(w + t) ? 'ferries' : 'highways' };
  }
  if (/\b(recalculate|reroute|re-route|recalc)\b|\b(update|refresh) (the |my )?route\b|пересчитай|перестрой маршрут|გადაითვალე მარშრუტი|მარშრუტის გადათვლა/.test(t)) {
    return { type: 'recalculate' };
  }
  if (/\b(another|alternative|other|different|faster) route\b|\bshow (me )?(the )?(routes|options)\b|другой маршрут|სხვა მარშრუტ/.test(t)) {
    return { type: 'alternatives' };
  }

  // Places along the route
  for (const [re, category] of POI_WORDS) {
    if (re.test(t) && /\b(find|search|where|look|show|need|any|nearest|closest|get)\b|найди|где|ближайш|нужн|იპოვე|სად|მჭირდება|ახლოს/.test(t)) {
      const detour = /(less than|under|within|max(imum)?|no more than) (\d+) ?(min|minute)/.exec(t) ?? /(\d+) ?(min|minute)s? detour/.exec(t);
      const near = /\bnear ([\p{L} -]+)$/u.exec(t) ?? /\bin ([\p{L} -]+)$/u.exec(t);
      const nearPlace = near && !/\b(route|way|me|here)\b/.test(near[1]) ? place(near[1]) : undefined;
      return {
        type: 'find_poi',
        category,
        maxDetourMin: detour ? Number(detour[detour.length - 2]) : undefined,
        near: nearPlace,
      };
    }
  }

  // Weather
  if (
    /\b(when|how long|how soon)\b.*\b(rain|snow|storm)\b|\b(rain|snow)\b.*\b(start|begin|stop|end|when)\b|\b(is it|will it|going to|gonna)\b.*\b(rain|snow)\b|когда.*дожд|будет ли дожд|დაიწყება.*წვიმა|წვიმა.*როდის|იწვიმებს/.test(t)
  ) {
    return { type: 'rain_when' };
  }
  const wx = /\bweather (in|at|near|for|around) ([\p{L} -]+)$/u.exec(t) ?? /погода (в|около|на) ([\p{L} -]+)$/u.exec(t) ?? /([\p{L}-]+)(-ში|ში)? ამინდი/u.exec(t);
  if (wx) {
    const p = place(wx[2] ?? wx[1]);
    if (p) return { type: 'weather_at', place: p };
  }
  const followUp = /^(what about|how about|and|and in|and at|а в|а|ხოლო) ([\p{L} -]+)$/u.exec(t);
  if (followUp) {
    const p = place(followUp[2]);
    if (p) return ctx.last?.type === 'distance_to' ? { type: 'distance_to', place: p } : { type: 'weather_at', place: p };
  }
  if (/\bweather\b|погод|ამინდ/.test(t)) return { type: 'weather_ahead' };

  // Navigation questions
  if (/\b(next (turn|maneuver|instruction|exit)|where do i turn|what('s| is) next)\b|следующ.*поворот|შემდეგი მოხვევა/.test(t)) {
    return { type: 'next_turn' };
  }
  if (/\b(traffic|congestion|jam|delays?|accident)\b|пробк|საცობ/.test(t)) return { type: 'traffic' };
  if (/\bwhere am i\b|\bwhat road\b|\bcurrent (location|position)\b|где я|სად ვარ/.test(t)) return { type: 'where_am_i' };
  const far = /\bhow far(?: is| to| away is)?(?: it)?(?: to)? ?([\p{L} -]*)$/u.exec(t) ?? /сколько (?:ехать )?до ([\p{L} -]+)$/u.exec(t);
  if (far) return { type: 'distance_to', place: place(far[1]) };
  if (/\b(eta|arrival|arrive|get there|when (will|do|shall) (i|we)|how long)\b|когда (приед|будем)|როდის ჩავალ|რამდენი ხანი/.test(t)) {
    return { type: 'eta' };
  }
  return { type: 'unknown', text: utterance };
}
