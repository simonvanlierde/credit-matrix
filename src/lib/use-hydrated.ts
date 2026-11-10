import { useEffect, useState } from "react";
import { useContributionStore } from "@/store/contribution-store";

/**
 * False until the persisted draft has been restored, true from then on.
 *
 * The store uses `skipHydration` and rehydrates from a mount effect (see
 * contribution-store.ts), so there is a brief window where the interface is
 * live but still showing the empty initial state. Anything typed in that window
 * is overwritten the moment the restored draft lands — the text is simply gone,
 * with nothing to say it ever arrived.
 *
 * Gate text inputs on this: Playwright and real people alike wait out a
 * read-only field, where both would lose a discarded keystroke.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useContributionStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useContributionStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}
