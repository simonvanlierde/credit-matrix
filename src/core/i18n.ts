export type { LocaleCode, RoleCatalog, RoleDescriber, RoleTranslator } from "./credit-i18n/index";
export {
  AVAILABLE_LOCALES,
  DEFAULT_ROLE_TRANSLATOR,
  hasCatalog,
  loadRoleCatalog,
  makeRoleDescriber,
  makeRoleTranslator,
  normalizeLocaleCode,
} from "./credit-i18n/index";
export type { UiCatalog, UiKey, UiTranslator } from "./credit-i18n/ui-strings";
export { DEFAULT_UI_TRANSLATOR, loadUiCatalog, makeUiTranslator } from "./credit-i18n/ui-strings";
