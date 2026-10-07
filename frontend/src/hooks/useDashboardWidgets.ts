import { useEffect, useState } from "react";
import { settingsApi, type DashboardWidgetChoices, type DashboardWidgetId } from "../api/settings";

// Saved on the account so every device shows the same dashboard. Shared by every user of the hook
// so there's one request, and a toggle shows everywhere at once.
let cached: DashboardWidgetChoices | undefined;
let inFlight: Promise<DashboardWidgetChoices> | null = null;
const listeners = new Set<(value: DashboardWidgetChoices) => void>();

function load(): Promise<DashboardWidgetChoices> {
  if (cached !== undefined) return Promise.resolve(cached);
  inFlight ??= settingsApi
    .getDashboardWidgets()
    // A toggle made while this is in flight is newer than the server's answer, so it wins.
    .then((res) => (cached = { ...res.widgets, ...cached }))
    // A failed load shows every widget at its default rather than an empty dashboard.
    .catch((): DashboardWidgetChoices => cached ?? {})
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function publish(value: DashboardWidgetChoices) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Null until the saved choices are known, so the page doesn't flash widgets the user hid. */
export function useDashboardWidgets(): [
  DashboardWidgetChoices | null,
  (id: DashboardWidgetId, enabled: boolean) => void,
] {
  const [value, setValue] = useState<DashboardWidgetChoices | null>(cached ?? null);

  useEffect(() => {
    let cancelled = false;
    void load().then((v) => {
      if (!cancelled) setValue(cached ?? v);
    });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);

  const setEnabled = (id: DashboardWidgetId, enabled: boolean) => {
    publish({ ...cached, [id]: enabled });
    // The toggle already happened here; a failed save only means other devices won't follow.
    settingsApi.updateDashboardWidgets({ [id]: enabled }).catch(() => {});
  };

  return [value, setEnabled];
}
