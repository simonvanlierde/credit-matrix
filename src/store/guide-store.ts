import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The getting-started checklist's own memory, per browser and apart from the drafts:
 * whether this visitor has copied a statement yet (the one step the drafts cannot
 * show) and whether they closed the checklist.
 */
interface GuideState {
  copied: boolean;
  dismissed: boolean;
  markCopied: () => void;
  dismiss: () => void;
}

export const useGuide = create<GuideState>()(
  persist(
    (set) => ({
      copied: false,
      dismissed: false,
      markCopied: () => set({ copied: true }),
      dismiss: () => set({ dismissed: true }),
    }),
    {
      name: "credit-matrix-guide",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ copied, dismissed }) => ({ copied, dismissed }),
      // Like the main store: the prerendered page knows no storage, so read it after mount.
      skipHydration: true,
    },
  ),
);
