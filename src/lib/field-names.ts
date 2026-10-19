/** OpenAlex field names with a translation; any other field shows its OpenAlex name. */
export const FIELD_KEYS = {
  "Agricultural and Biological Sciences": "censusFieldAgriculturalAndBiologicalSciences",
  "Biochemistry, Genetics and Molecular Biology": "censusFieldBiochemistryGeneticsAndMolecularBiology",
  Chemistry: "censusFieldChemistry",
  "Computer Science": "censusFieldComputerScience",
  Dentistry: "censusFieldDentistry",
  "Economics, Econometrics and Finance": "censusFieldEconomicsEconometricsAndFinance",
  Engineering: "censusFieldEngineering",
  "Environmental Science": "censusFieldEnvironmentalScience",
  "Health Professions": "censusFieldHealthProfessions",
  "Immunology and Microbiology": "censusFieldImmunologyAndMicrobiology",
  "Materials Science": "censusFieldMaterialsScience",
  Mathematics: "censusFieldMathematics",
  Medicine: "censusFieldMedicine",
  Multidisciplinary: "censusFieldMultidisciplinary",
  Neuroscience: "censusFieldNeuroscience",
  "Physics and Astronomy": "censusFieldPhysicsAndAstronomy",
  Psychology: "censusFieldPsychology",
  "Social Sciences": "censusFieldSocialSciences",
} as const;

/** The message key that translates an OpenAlex field name, or undefined when there is none. */
export function fieldKey(name: string): (typeof FIELD_KEYS)[keyof typeof FIELD_KEYS] | undefined {
  return Object.hasOwn(FIELD_KEYS, name) ? FIELD_KEYS[name as keyof typeof FIELD_KEYS] : undefined;
}
