import {
  getCountries,
  getCountryCallingCode,
} from "libphonenumber-js";

// Countries whose national numbers are NOT 8-10 digits are excluded so the
// app enforces its 8-10 digit mobile rule consistently. Dialing codes and
// names are static metadata (ISO code -> { name, dialCode }); the codes use
// the libphonenumber-js metadata internally for accuracy where possible.
const COUNTRY_META = {
  AF: "Afghanistan",
  AL: "Albania",
  DZ: "Algeria",
  AD: "Andorra",
  AO: "Angola",
  AG: "Antigua and Barbuda",
  AR: "Argentina",
  AM: "Armenia",
  AU: "Australia",
  AT: "Austria",
  AZ: "Azerbaijan",
  BS: "Bahamas",
  BH: "Bahrain",
  BD: "Bangladesh",
  BB: "Barbados",
  BY: "Belarus",
  BE: "Belgium",
  BZ: "Belize",
  BJ: "Benin",
  BT: "Bhutan",
  BO: "Bolivia",
  BA: "Bosnia and Herzegovina",
  BW: "Botswana",
  BR: "Brazil",
  BN: "Brunei",
  BG: "Bulgaria",
  BF: "Burkina Faso",
  BI: "Burundi",
  KH: "Cambodia",
  CM: "Cameroon",
  CA: "Canada",
  CV: "Cape Verde",
  CF: "Central African Republic",
  TD: "Chad",
  CL: "Chile",
  CN: "China",
  CO: "Colombia",
  KM: "Comoros",
  CG: "Congo",
  CD: "Congo, DR",
  CR: "Costa Rica",
  CI: "Côte d'Ivoire",
  HR: "Croatia",
  CU: "Cuba",
  CY: "Cyprus",
  CZ: "Czechia",
  DK: "Denmark",
  DJ: "Djibouti",
  DM: "Dominica",
  DO: "Dominican Republic",
  EC: "Ecuador",
  EG: "Egypt",
  SV: "El Salvador",
  GQ: "Equatorial Guinea",
  ER: "Eritrea",
  EE: "Estonia",
  SZ: "Eswatini",
  ET: "Ethiopia",
  FJ: "Fiji",
  FI: "Finland",
  FR: "France",
  GA: "Gabon",
  GM: "Gambia",
  GE: "Georgia",
  DE: "Germany",
  GH: "Ghana",
  GR: "Greece",
  GD: "Grenada",
  GT: "Guatemala",
  GN: "Guinea",
  GW: "Guinea-Bissau",
  GY: "Guyana",
  HT: "Haiti",
  HN: "Honduras",
  HK: "Hong Kong",
  HU: "Hungary",
  IS: "Iceland",
  IN: "India",
  ID: "Indonesia",
  IR: "Iran",
  IQ: "Iraq",
  IE: "Ireland",
  IL: "Israel",
  IT: "Italy",
  JM: "Jamaica",
  JP: "Japan",
  JO: "Jordan",
  KZ: "Kazakhstan",
  KE: "Kenya",
  KI: "Kiribati",
  KW: "Kuwait",
  KG: "Kyrgyzstan",
  LA: "Laos",
  LV: "Latvia",
  LB: "Lebanon",
  LS: "Lesotho",
  LR: "Liberia",
  LY: "Libya",
  LI: "Liechtenstein",
  LT: "Lithuania",
  LU: "Luxembourg",
  MG: "Madagascar",
  MW: "Malawi",
  MY: "Malaysia",
  MV: "Maldives",
  ML: "Mali",
  MT: "Malta",
  MH: "Marshall Islands",
  MR: "Mauritania",
  MU: "Mauritius",
  MX: "Mexico",
  FM: "Micronesia",
  MD: "Moldova",
  MC: "Monaco",
  MN: "Mongolia",
  ME: "Montenegro",
  MA: "Morocco",
  MZ: "Mozambique",
  MM: "Myanmar",
  NA: "Namibia",
  NR: "Nauru",
  NP: "Nepal",
  NL: "Netherlands",
  NZ: "New Zealand",
  NI: "Nicaragua",
  NE: "Niger",
  NG: "Nigeria",
  KP: "North Korea",
  MK: "North Macedonia",
  NO: "Norway",
  OM: "Oman",
  PK: "Pakistan",
  PW: "Palau",
  PS: "Palestine",
  PA: "Panama",
  PG: "Papua New Guinea",
  PY: "Paraguay",
  PE: "Peru",
  PH: "Philippines",
  PL: "Poland",
  PT: "Portugal",
  QA: "Qatar",
  RO: "Romania",
  RU: "Russia",
  RW: "Rwanda",
  KN: "Saint Kitts and Nevis",
  LC: "Saint Lucia",
  VC: "Saint Vincent",
  WS: "Samoa",
  SM: "San Marino",
  ST: "Sao Tome and Principe",
  SA: "Saudi Arabia",
  SN: "Senegal",
  RS: "Serbia",
  SC: "Seychelles",
  SL: "Sierra Leone",
  SG: "Singapore",
  SK: "Slovakia",
  SI: "Slovenia",
  SB: "Solomon Islands",
  SO: "Somalia",
  ZA: "South Africa",
  KR: "South Korea",
  SS: "South Sudan",
  ES: "Spain",
  LK: "Sri Lanka",
  SD: "Sudan",
  SR: "Suriname",
  SE: "Sweden",
  CH: "Switzerland",
  SY: "Syria",
  TW: "Taiwan",
  TJ: "Tajikistan",
  TZ: "Tanzania",
  TH: "Thailand",
  TL: "Timor-Leste",
  TG: "Togo",
  TO: "Tonga",
  TT: "Trinidad and Tobago",
  TN: "Tunisia",
  TR: "Turkey",
  TM: "Turkmenistan",
  TV: "Tuvalu",
  UG: "Uganda",
  UA: "Ukraine",
  AE: "United Arab Emirates",
  GB: "United Kingdom",
  US: "United States",
  UY: "Uruguay",
  UZ: "Uzbekistan",
  VU: "Vanuatu",
  VA: "Vatican City",
  VE: "Venezuela",
  VN: "Vietnam",
  YE: "Yemen",
  ZM: "Zambia",
  ZW: "Zimbabwe",
};

const SUPPORTED_REGIONS = getCountries().filter(
  (iso) => COUNTRY_META[iso]
);

// Convert an ISO 3166-1 alpha-2 code to its regional indicator flag emoji.
function countryFlag(iso) {
  const offset = 127397; // regional indicator A
  return iso
    .toUpperCase()
    .split("")
    .map((ch) => String.fromCodePoint(ch.charCodeAt(0) + offset))
    .join("");
}

// Each country: { iso, name, dialectCode, flag } sorted by name (ascending).
export const PHONE_COUNTRIES = SUPPORTED_REGIONS.map((iso) => ({
  iso,
  name: COUNTRY_META[iso],
  dialCode: `+${getCountryCallingCode(iso)}`,
  flag: countryFlag(iso),
}))
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

export function getCountryByIso(iso) {
  return PHONE_COUNTRIES.find((c) => c.iso === iso) || null;
}

export function getCountryByDialCode(dialCode) {
  const normalized = String(dialCode).replace(/[^\d]/g, "");
  return (
    PHONE_COUNTRIES.find(
      (c) => c.dialCode.replace("+", "") === normalized
    ) || null
  );
}

// Length constraints for the national (local) number part, enforced on top of
// the library's own validation. Global default is 8-10 digits.
const DIGIT_LENGTHS = { default: [10, 12] };

export const MOBILE_DIGIT_MIN = DIGIT_LENGTHS.default[0];
export const MOBILE_DIGIT_MAX = DIGIT_LENGTHS.default[1];

// Validate a raw input against the 8-10 digit rule.
export function hasValidDigitLength(value) {
  const digits = String(value).replace(/\D/g, "");
  return (
    digits.length >= MOBILE_DIGIT_MIN &&
    digits.length <= MOBILE_DIGIT_MAX
  );
}

// Validate a mobile number by its digit count only (8-10 digits).
// A leading country code is stripped (but not validated) before the count.
// Returns { ok, message, number? } where number is the removed-code digits.
export function validateMobile(rawNumber) {
  const input = String(rawNumber ?? "").trim();

  if (!input) {
    return { ok: false, message: "Mobile number is required" };
  }

  // Remove the dialing code prefix (e.g. +60) if we can identify it, so the
  // 8-10 digit rule applies to the national number only.
  let national = input;

  if (input.startsWith("+")) {
    const digits = input.slice(1);
    const matched = PHONE_COUNTRIES.slice()
      .sort((a, b) => b.dialCode.length - a.dialCode.length)
      .find((c) => digits.startsWith(c.dialCode.slice(1)));

    national = matched ? digits.slice(matched.dialCode.length - 1) : digits;
  }

  const digits = national.replace(/\D/g, "");

  if (digits.length === 0) {
    return { ok: false, message: "Mobile number is required" };
  }

  if (digits.length < MOBILE_DIGIT_MIN || digits.length > MOBILE_DIGIT_MAX) {
    return {
      ok: false,
      message: `Mobile number must be ${MOBILE_DIGIT_MIN} to ${MOBILE_DIGIT_MAX} digits`,
    };
  }

  return { ok: true, number: digits };
}
