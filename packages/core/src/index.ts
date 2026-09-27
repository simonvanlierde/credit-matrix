export type { Author, Contribution } from "./author";
export {
  AuthorSchema,
  ContributionSchema,
  clampScore,
  isAllBinary,
  isUsableAuthorName,
  isValidOrcid,
  MAX_AUTHOR_NAME_LENGTH,
  MAX_AUTHORS,
  MAX_IMPORT_BYTES,
  normalizeOrcid,
  ORCID_REGEX,
  rolesWithContributions,
  scoreToLevel,
} from "./author";
export {
  DEFAULT_MONO_COLOR,
  heatCellColor,
  OKABE_ITO,
  onColor,
} from "./contributor-color";
export type { LocaleCode, RoleDescriber, RoleTranslator } from "./credit-i18n/index";
export {
  AVAILABLE_LOCALES,
  DEFAULT_ROLE_TRANSLATOR,
  loadRoleCatalog,
  makeRoleDescriber,
  makeRoleTranslator,
  normalizeLocaleCode,
} from "./credit-i18n/index";
export type { UiKey, UiTranslator } from "./credit-i18n/ui-strings";
export { DEFAULT_UI_TRANSLATOR, loadUiCatalog, makeUiTranslator } from "./credit-i18n/ui-strings";
export type { CreditRoleName } from "./credit-roles";
export { CREDIT_ROLES, getRoleByName } from "./credit-roles";
export type { DoiLookupResult } from "./doi-lookup";
export { DOI_INPUT_REGEX, lookupDoiWork, normalizeDoi } from "./doi-lookup";
export { fromCsv, toCsv } from "./export/csv";
export { buildHeatmapSvg } from "./export/heatmap-svg";
export { fromJson, toJson } from "./export/json";
export { toMarkdown } from "./export/markdown";
export { toJats4rXml } from "./export/xml";
export { fromJats4rXml, fromXmlDocument } from "./export/xml-import";
export type { StatementFormat } from "./generate-statement";
export { generateStatement } from "./generate-statement";
export { mergeContributorRow } from "./merge-row";
export type { OrcidLookupResult } from "./orcid-lookup";
export { lookupOrcidPerson } from "./orcid-lookup";
export {
  createAuthor,
  deduplicateAuthorInitials,
  parseAuthorText,
  splitNameList,
} from "./parse-authors";
export type { ShareData, SharePayloadInput } from "./share-payload";
export { fromSharePayload, toSharePayload } from "./share-payload";
export { validateContributions } from "./validate";
