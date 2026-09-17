import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  BodyweightEntry,
  ExerciseMeta,
  RawImport,
  Settings,
  Workout,
} from '../model/types';
import { DEFAULT_SETTINGS } from '../model/types';
import { parseCsv, type ParseResult } from '../ingest/parseCsv';
import { HeaderMappingError } from '../ingest/headerMap';
import { emptyReport } from '../ingest/report';
import { buildMetaIndex, type MetaIndex } from '../meta/metaIndex';
import { guessMeta } from '../meta/guessMeta';
import { seedFor } from '../meta/seedMeta';
import { makeBodyweightResolver, type BodyweightResolver } from '../model/bodyweight';
import { enrichSets, type EnrichedSet } from '../model/effectiveLoad';
import { scopeSets, type ScopeMonths } from '../derive/buckets';
import type { ValidationWarning } from '../model/schemas';
import {
  loadAll,
  resetAll,
  saveBodyweight,
  saveImport,
  saveMeta,
  saveSettings,
} from './idb';
import { clearComparePerson, hydrateComparePerson } from './comparePerson';

/**
 * The single memo graph, mounted once and shared by context.
 *
 * Without this, each view would build its own chain and parse the corpus twice.
 * The dependency arrays here are load-bearing: M1 depends on the raw text and the
 * import-time unit ONLY, so editing metadata never re-parses thousands of rows.
 */

type Status = 'loading' | 'ready' | 'degraded';

const EMPTY_PARSE: ParseResult = { workouts: [], sets: [], report: emptyReport('', 0) };

export type WorkoutData = {
  status: Status;
  warnings: ValidationWarning[];
  parseError: string | null;

  current: RawImport | null;
  archive: RawImport[];
  settings: Settings;
  bodyweight: BodyweightEntry[];
  meta: Record<string, ExerciseMeta>;

  workouts: Workout[];
  sets: EnrichedSet[];
  /**
   * The date-range scope: months back from the last session, or null for all.
   * Ephemeral -- it is a way of looking, not a fact about the data, so it is
   * neither persisted nor in the URL, and a reload shows everything again.
   */
  scope: ScopeMonths;
  setScope(scope: ScopeMonths): void;
  /**
   * `sets` and `workouts` inside the scope. Every analytical view reads these;
   * Import, the tagging tray and Compare read the full corpus, because
   * metadata, guessing and a comparison against a whole second export are not
   * things a date range should change. `scope === null` returns `sets` itself,
   * so the memos downstream keep their cache.
   */
  scopedSets: EnrichedSet[];
  scopedWorkouts: Workout[];
  report: ParseResult['report'];
  metaIndex: MetaIndex;
  bodyweightAt: BodyweightResolver;

  /** Names present in the CSV, with what was logged, for the guesser and the tray. */
  observed: Map<string, ObservedExercise>;
  unconfirmedCount: number;

  importCsv(text: string, filename: string): Promise<void>;
  updateMeta(name: string, patch: Partial<ExerciseMeta>): void;
  confirmMeta(name: string): void;
  confirmAll(): void;
  replaceMeta(next: Record<string, ExerciseMeta>): void;
  setBodyweight(entries: BodyweightEntry[]): void;
  updateSettings(patch: Partial<Settings>): void;
  reset(): Promise<void>;
  rollbackTo(item: RawImport): Promise<void>;
};

export type ObservedExercise = {
  name: string;
  setCount: number;
  anyNonZero: boolean;
  anySeconds: boolean;
  anyDistance: boolean;
  firstDate: Date | null;
  lastDate: Date | null;
};

const Ctx = createContext<WorkoutData | null>(null);

export function useWorkoutData(): WorkoutData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkoutData must be used inside <WorkoutDataProvider>');
  return ctx;
}

export function WorkoutDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [warnings, setWarnings] = useState<ValidationWarning[]>([]);
  const [current, setCurrent] = useState<RawImport | null>(null);
  const [archive, setArchive] = useState<RawImport[]>([]);
  const [meta, setMeta] = useState<Record<string, ExerciseMeta>>({});
  const [bodyweight, setBodyweightState] = useState<BodyweightEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [scope, setScope] = useState<ScopeMonths>(null);

  // Read through a ref inside the auto-extension effect so `meta` is never a dep.
  const metaRef = useRef(meta);
  metaRef.current = meta;

  // --- hydration -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void loadAll().then((s) => {
      if (cancelled) return;
      setCurrent(s.current);
      setArchive(s.archive);
      setMeta(s.meta);
      setBodyweightState(s.bodyweight);
      setSettings(s.settings);
      // The other person lives in a module store, not in this provider's state --
      // only Compare cares about them. This is the one place that already awaits
      // IDB, so the seed happens here rather than opening a second connection.
      hydrateComparePerson(s.comparePerson);
      setWarnings(s.warnings);
      setStatus(s.warnings.length > 0 ? 'degraded' : 'ready');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- M1: parse. Depends on text + import unit ONLY. -------------------------
  const text = current?.text ?? '';
  const unit = current?.unit ?? 'kg';
  const { result: parsed, error: parseError } = useMemo((): {
    result: ParseResult;
    error: string | null;
  } => {
    if (text === '') return { result: EMPTY_PARSE, error: null };
    try {
      return { result: parseCsv(text, { unit }), error: null };
    } catch (err) {
      // A stored import whose headers we can no longer map: degrade to an empty
      // model and show why, rather than white-screening the whole app.
      const message =
        err instanceof HeaderMappingError || err instanceof Error ? err.message : String(err);
      return { result: EMPTY_PARSE, error: message };
    }
  }, [text, unit]);

  // --- M2: what the CSV actually contains ------------------------------------
  const observed = useMemo(() => {
    const map = new Map<string, ObservedExercise>();
    for (const s of parsed.sets) {
      let o = map.get(s.exerciseName);
      if (!o) {
        o = {
          name: s.exerciseName,
          setCount: 0,
          anyNonZero: false,
          anySeconds: false,
          anyDistance: false,
          firstDate: null,
          lastDate: null,
        };
        map.set(s.exerciseName, o);
      }
      o.setCount++;
      if ((s.weightKg ?? 0) !== 0) o.anyNonZero = true;
      if ((s.seconds ?? 0) > 0) o.anySeconds = true;
      if ((s.distanceRaw ?? 0) !== 0) o.anyDistance = true;
      if (o.firstDate === null || s.date < o.firstDate) o.firstDate = s.date;
      if (o.lastDate === null || s.date > o.lastDate) o.lastDate = s.date;
    }
    return map;
  }, [parsed.sets]);

  /** Stable key so the effect below fires on the NAME SET, not on every parse. */
  const namesKey = useMemo(() => [...observed.keys()].sort().join('\u0000'), [observed]);

  // --- auto-extension: new CSV names get seeded/guessed metadata ---------------
  useEffect(() => {
    // Guard 1 (the dangerous one): before hydration resolves, `meta` is {} and every
    // name looks new -- writing here would overwrite the user's confirmed tags.
    if (status === 'loading') return;
    if (namesKey === '') return;

    const existing = metaRef.current;
    const missing = [...observed.keys()].filter((n) => existing[n] === undefined);
    // Guard 2: bail before touching state, so this cannot loop.
    if (missing.length === 0) return;

    const additions: Record<string, ExerciseMeta> = {};
    for (const name of missing) {
      const o = observed.get(name);
      const seeded = seedFor(name);
      additions[name] =
        seeded ??
        guessMeta(name, {
          observedWeights: {
            anyNonZero: o?.anyNonZero ?? true,
            anySeconds: o?.anySeconds ?? false,
            anyDistance: o?.anyDistance ?? false,
          },
        });
    }

    setMeta((prev) => {
      // Guard 3: additive-only merge, and return prev by identity when nothing
      // changed so React bails out and the downstream memos do not re-run.
      let changed = false;
      const next = { ...prev };
      for (const [name, m] of Object.entries(additions)) {
        if (next[name] === undefined) {
          next[name] = m;
          changed = true;
        }
      }
      if (!changed) return prev;
      void saveMeta(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, status]);

  // --- M3 / M4 / M5 -----------------------------------------------------------
  const metaIndex = useMemo(() => buildMetaIndex(meta), [meta]);

  const bodyweightAt = useMemo(
    () => makeBodyweightResolver(bodyweight, settings.defaultBodyweightKg),
    [bodyweight, settings.defaultBodyweightKg],
  );

  const sets = useMemo(
    () => enrichSets(parsed.sets, metaIndex, bodyweightAt),
    [parsed.sets, metaIndex, bodyweightAt],
  );

  // --- the scope, strictly below M5: filters by reference, never re-enriches --
  const scopedSets = useMemo(() => scopeSets(sets, scope), [sets, scope]);
  const scopedWorkouts = useMemo(() => {
    if (scopedSets === sets) return parsed.workouts;
    const keep = new Set(scopedSets.map((s) => s.workoutId));
    return parsed.workouts.filter((w) => keep.has(w.id));
  }, [scopedSets, sets, parsed.workouts]);

  const unconfirmedCount = useMemo(
    () => [...observed.keys()].filter((n) => meta[n]?.confirmed !== true).length,
    [observed, meta],
  );

  // --- actions ----------------------------------------------------------------
  const importCsv = useCallback(
    async (csvText: string, filename: string) => {
      // Validate before persisting: an unparseable file must not replace a good one.
      parseCsv(csvText, { filename, unit: settings.inputUnit });
      const next: RawImport = {
        text: csvText,
        importedAt: Date.now(),
        filename,
        unit: settings.inputUnit,
      };
      await saveImport(next);
      setArchive((prev) => (current ? [current, ...prev].slice(0, 5) : prev));
      setCurrent(next);
    },
    [current, settings.inputUnit],
  );

  const commitMeta = useCallback((updater: (prev: Record<string, ExerciseMeta>) => Record<string, ExerciseMeta>) => {
    setMeta((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      void saveMeta(next);
      return next;
    });
  }, []);

  const updateMeta = useCallback(
    (name: string, patch: Partial<ExerciseMeta>) => {
      commitMeta((prev) => {
        const base = prev[name] ?? guessMeta(name);
        const merged: ExerciseMeta = { ...base, ...patch, name };
        if (merged.aliasOf === '' || merged.aliasOf === name) delete merged.aliasOf;
        return { ...prev, [name]: merged };
      });
    },
    [commitMeta],
  );

  const confirmMeta = useCallback(
    (name: string) => {
      commitMeta((prev) => {
        const base = prev[name] ?? guessMeta(name);
        return { ...prev, [name]: { ...base, confirmed: true } };
      });
    },
    [commitMeta],
  );

  const confirmAll = useCallback(() => {
    commitMeta((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const name of observed.keys()) {
        const base = next[name] ?? guessMeta(name);
        if (!base.confirmed) {
          next[name] = { ...base, confirmed: true };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [commitMeta, observed]);

  const replaceMeta = useCallback(
    (nextMeta: Record<string, ExerciseMeta>) => {
      commitMeta(() => nextMeta);
    },
    [commitMeta],
  );

  const setBodyweight = useCallback((entries: BodyweightEntry[]) => {
    setBodyweightState(entries);
    void saveBodyweight(entries);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(async () => {
    await resetAll();
    // resetAll deleted compare:person, but the module store would keep serving
    // its in-memory copy until a reload.
    clearComparePerson();
    setCurrent(null);
    setArchive([]);
    setMeta({});
    setBodyweightState([]);
    setSettings(DEFAULT_SETTINGS);
    setWarnings([]);
    setStatus('ready');
  }, []);

  const rollbackTo = useCallback(async (item: RawImport) => {
    await saveImport(item);
    setCurrent(item);
  }, []);

  const value: WorkoutData = {
    status,
    warnings,
    parseError,
    current,
    archive,
    settings,
    bodyweight,
    meta,
    workouts: parsed.workouts,
    sets,
    scope,
    setScope,
    scopedSets,
    scopedWorkouts,
    report: parsed.report,
    metaIndex,
    bodyweightAt,
    observed,
    unconfirmedCount,
    importCsv,
    updateMeta,
    confirmMeta,
    confirmAll,
    replaceMeta,
    setBodyweight,
    updateSettings,
    reset,
    rollbackTo,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
