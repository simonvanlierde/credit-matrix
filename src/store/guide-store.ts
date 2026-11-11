import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The getting-started checklist's own memory, per browser and apart from the drafts:
 * whether this visitor has copied a statement yet (the one step the drafts cannot
 * show) and whether they closed the checklist.
 */
/** The checklist's storage key; deleting every draft clears it too. */
export const GUIDE_KEY = "credit-matrix-guide";

interface GuideState {
  copied: boolean;
  dismissed: boolean;
  markCopied: () => void;
  dismiss: () => void;
}

/**
 * Load storage before a write, which saves the whole state: this tab may not have read it yet (a
 * claim link shows no checklist but can copy) or another tab may have changed it since. Local
 * storage is synchronous, so the read lands before the write. Absent with storage blocked.
 */
const reload = () => void useGuide.persist?.rehydrate();

export const useGuide = create<GuideState>()(
  persist(
    (set) => ({
      copied: false,
      dismissed: false,
      markCopied: () => {
        reload();
        set({ copied: true });
      },
      dismiss: () => {
        reload();
        set({ dismissed: true });
      },
    }),
    {
      name: GUIDE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ copied, dismissed }) => ({ copied, dismissed }),
      // Like the main store: the prerendered page knows no storage, so read it after mount.
      skipHydration: true,
    },
  ),
);
