import { ColorSwatches, SettingChoice, SettingSwitch, SettingsSection } from "@/components/ui/settings-panel";
import { contrastRatio, heatCellColor } from "@/core/contributor-color";
import { useTranslations } from "@/lib/translations";
import { useContributionStore } from "@/store/contribution-store";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Colour, orientation and initials: what the grid shows and the figure draws, stored once per
 * draft. The grid's Heatmap options and Figure settings both render this one component, so the
 * two panels can never drift apart.
 */
export function GridViewSettings() {
  const t = useTranslations();
  const color = useContributionStore((s) => s.heatmapMonoColor);
  const setColor = useContributionStore((s) => s.setHeatmapMonoColor);
  const perContributor = useContributionStore((s) => s.colorByContributor);
  const setPerContributor = useContributionStore((s) => s.setColorByContributor);
  const transpose = useContributionStore((s) => s.transpose);
  const setTranspose = useContributionStore((s) => s.setTranspose);
  const initials = useContributionStore((s) => s.initials);
  const setInitials = useContributionStore((s) => s.setInitials);
  // One hue whose lowest level barely differs from an empty cell.
  const pale =
    !perContributor && HEX_COLOR.test(color) && contrastRatio(heatCellColor(color, 33), heatCellColor(color, 0)) < 1.5;
  return (
    <>
      <ColorSwatches
        label={t("colorLabel")}
        color={color}
        perContributor={perContributor}
        onColor={setColor}
        onPerContributor={() => setPerContributor(true)}
      />
      {pale && <p className="text-on-surface-variant">{t("heatmapPaleColor")}</p>}
      <SettingsSection label={t("heatmapLayout")}>
        <SettingChoice
          label={t("heatmapOrientation")}
          value={transpose ? "contributors" : "roles"}
          onChange={(next) => setTranspose(next === "contributors")}
          options={[
            ["roles", t("heatmapRolesInRows")],
            ["contributors", t("heatmapContributorsInRows")],
          ]}
        />
        {/* The accessible name starts with the visible "Use initials",
          so voice control saying the visible label hits it (2.5.3). */}
        <SettingSwitch
          label={t("useInitials")}
          checked={initials}
          onChange={setInitials}
          ariaLabel={t("a11yUseInitials")}
        />
      </SettingsSection>
    </>
  );
}
