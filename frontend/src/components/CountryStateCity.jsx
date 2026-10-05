import { useEffect, useMemo, useRef, useState } from "react";
import { listGeoCountries, listGeoStates, listGeoCities } from "../services/geo";
import SearchSelect from "./SearchSelect";

// Cascading country -> state -> city pickers.
//
// Each level narrows the next, and changing a level clears everything below it,
// so a Maharashtra state can never survive a switch to Kerala. The lists arrive
// once and are filtered in the browser: the largest is 250 countries, so
// server-side search on every keystroke would be slower, not faster.
//
// City is fetched per state and can run to thousands of rows, so the list is
// capped and the dropdown says so rather than pretending the list is complete.

export default function CountryStateCity({
  country, state, city,
  onCountryChange, onStateChange, onCityChange,
  labels = {},
}) {
  const [countries, setCountries] = useState([]);
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [countryUuid, setCountryUuid] = useState("");
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [cityTruncated, setCityTruncated] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    let active = true;
    listGeoCountries()
      .then((d) => { if (active) setCountries(d.countries || []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // A row saved before these pickers existed holds free text, sometimes an ISO
  // code such as 'IN', so resolve name / iso2 / iso3 / uuid to one option.
  useEffect(() => {
    if (!country) { setCountryUuid(""); return; }
    const match = countries.find(
      (c) => c.name === country || c.iso2 === country || c.iso3 === country
    );
    if (match) setCountryUuid(match.uuid);
  }, [country, countries]);

  useEffect(() => {
    if (!countryUuid) { setStates([]); return undefined; }
    let active = true;
    setLoadingStates(true);
    listGeoStates({ country: countryUuid })
      .then((d) => { if (active) setStates(d.states || []); })
      .catch(() => { if (active) setStates([]); })
      .finally(() => { if (active) setLoadingStates(false); });
    return () => { active = false; };
  }, [countryUuid]);

  // The cities endpoint keys on the state's uuid while the form stores its name.
  const stateUuid = useMemo(
    () => (state ? states.find((s) => s.name === state)?.uuid || "" : ""),
    [state, states]
  );

  useEffect(() => {
    if (!countryUuid) { setCities([]); setCityTruncated(false); return undefined; }
    let active = true;
    const id = ++requestRef.current;
    setLoadingCities(true);
    listGeoCities({ state: stateUuid, country: stateUuid ? "" : countryUuid, limit: 500 })
      .then((d) => {
        if (!active || id !== requestRef.current) return;
        setCities(d.cities || []);
        setCityTruncated(Boolean(d.truncated));
      })
      .catch(() => { if (active && id === requestRef.current) { setCities([]); setCityTruncated(false); } })
      .finally(() => { if (active && id === requestRef.current) setLoadingCities(false); });
    return () => { active = false; };
  }, [countryUuid, stateUuid]);

  const countryOptions = useMemo(
    () => countries.map((c) => ({
      value: c.uuid,
      label: c.name,
      meta: [c.iso2, c.dialcode].filter(Boolean).join(" · "),
      flag: c.flag,
      dialcode: c.dialcode,
      iso2: c.iso2,
    })),
    [countries]
  );

  const stateOptions = useMemo(
    () => states.map((s) => ({ value: s.name, label: s.name, meta: s.statecode || "", code: s.statecode })),
    [states]
  );

  const cityOptions = useMemo(
    () => cities.map((c) => ({ value: c.name, label: c.name })),
    [cities]
  );

  const chosenCountry = countries.find((c) => c.uuid === countryUuid);

  return (
    <div className="frm-grid csc">
      <SearchSelect
        id="geo-country"
        label={labels.country || "Country"}
        value={countryUuid}
        options={countryOptions}
        onChange={(uuid) => {
          setCountryUuid(uuid);
          const picked = countries.find((c) => c.uuid === uuid);
          onCountryChange(picked ? picked.name : "");
          // Clearing the levels below is what stops a stale state surviving.
          onStateChange("");
          onCityChange("");
        }}
        placeholder="Search countries…"
        renderValue={(option) => (
          <span className="ss-with-flag">
            {option.flag && <span aria-hidden="true">{option.flag}</span>}
            {option.label}
          </span>
        )}
        renderOption={(option) => (
          <>
            <span className="ss-option-main">
              {option.flag && <span className="ss-flag" aria-hidden="true">{option.flag}</span>}
              <span className="ss-option-label">{option.label}</span>
            </span>
            <span className="ss-option-meta">{option.meta}</span>
          </>
        )}
      />

      <SearchSelect
        id="geo-state"
        label={labels.state || "State / region"}
        value={state || ""}
        options={stateOptions}
        onChange={(name) => { onStateChange(name); onCityChange(""); }}
        loading={loadingStates}
        disabled={!countryUuid}
        placeholder={countryUuid ? "Search states…" : "Choose a country first"}
        emptyText={countryUuid ? "No states recorded for this country" : "Choose a country first"}
        renderValue={(option) => (
          <span className="ss-with-flag">
            {option.code && <span className="ss-code">{option.code}</span>}
            {option.label}
          </span>
        )}
        renderOption={(option) => (
          <>
            <span className="ss-option-label">{option.label}</span>
            {option.code && <span className="ss-option-meta">{option.code}</span>}
          </>
        )}
      />

      <SearchSelect
        id="geo-city"
        label={labels.city || "City"}
        value={city || ""}
        options={cityOptions}
        onChange={onCityChange}
        loading={loadingCities}
        disabled={!countryUuid}
        placeholder={countryUuid ? "Search cities…" : "Choose a country first"}
        emptyText={countryUuid ? "No cities recorded" : "Choose a country first"}
        hint={
          cityTruncated
            ? `${cities.length}+ cities — type to narrow`
            : chosenCountry?.dialcode
              ? `Dial code ${chosenCountry.dialcode}`
              : undefined
        }
      />
    </div>
  );
}
