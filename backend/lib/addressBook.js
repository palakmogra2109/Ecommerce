import { randomUUID } from "node:crypto";
import { validateMobile } from "./phone.js";

export const MAX_SAVED_ADDRESSES = 10;
const REQUIRED_FIELDS = ["line1", "city", "state", "postalCode"];
const ADDRESS_SOURCES = new Set(["manual", "geolocation", "claimed"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value, max = 200) {
  return text(value).slice(0, max);
}

function normalizePhone(value) {
  const raw = text(value);
  if (raw.startsWith("+")) {
    const digits = raw.replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }
  return raw.replace(/\D/g, "").slice(-10);
}

function phoneError(value) {
  if (!value) return "Enter a mobile number.";
  return validateMobile(value).ok === true ? "" : "Enter a valid mobile number.";
}

function coordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeAddressBook(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry) => entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.length > 0
  );
}

export function validateAddressInput(input = {}) {
  const source = text(input.source) || "manual";
  const candidate = {
    label: optionalText(input.label, 40) || "Home",
    recipient: optionalText(input.recipient, 120),
    phone: normalizePhone(input.phone),
    line1: optionalText(input.line1),
    line2: optionalText(input.line2),
    landmark: optionalText(input.landmark),
    city: optionalText(input.city, 120),
    state: optionalText(input.state, 120),
    country: optionalText(input.country, 120) || "India",
    postalCode: text(input.postalCode).replace(/\D/g, ""),
    latitude: coordinate(input.latitude),
    longitude: coordinate(input.longitude),
    isDefault: input.isDefault === true,
    source: ADDRESS_SOURCES.has(source) ? source : "manual",
  };
  const errors = {};
  if (!candidate.recipient) errors.recipient = "Enter the recipient name.";
  if (!candidate.line1) errors.line1 = "Enter house, street, or area.";
  if (!candidate.city) errors.city = "Enter city.";
  if (!candidate.state) errors.state = "Enter state.";
  if (!/^\d{6}$/.test(candidate.postalCode)) errors.postalCode = "Enter a 6-digit pincode.";
  const badPhone = phoneError(candidate.phone);
  if (badPhone) errors.phone = badPhone;
  if (Object.keys(errors).length > 0) return { errors };
  for (const field of REQUIRED_FIELDS) {
    if (!candidate[field]) return { errors: { [field]: "This field is required." } };
  }
  return { address: candidate };
}

function stamp(entry, now) {
  return { ...entry, createdAt: entry.createdAt || now, updatedAt: now };
}

export function createAddressEntry(book, input, now = new Date().toISOString()) {
  const existing = normalizeAddressBook(book);
  if (existing.length >= MAX_SAVED_ADDRESSES) {
    return { error: "You can save up to 10 addresses. Delete one to add another." };
  }
  const { address, errors } = validateAddressInput(input);
  if (errors) return { error: "Enter a complete address.", errors };
  return {
    address: stamp(
      {
        ...address,
        id: randomUUID(),
        isDefault: existing.length === 0 ? true : address.isDefault,
      },
      now
    ),
  };
}

function applySingleDefault(book) {
  let found = false;
  return book.map((entry) => {
    if (entry.isDefault && !found) {
      found = true;
      return entry;
    }
    return { ...entry, isDefault: false };
  });
}

export function updateAddressEntry(book, id, patch = {}) {
  const existing = normalizeAddressBook(book);
  const target = existing.find((entry) => entry.id === id);
  if (!target) return { error: "Address not found." };
  const merged = { ...target, ...patch, id: target.id };
  const { address, errors } = validateAddressInput(merged);
  if (errors) return { error: "Enter a complete address.", errors };
  const updated = existing.map((entry) => {
    if (entry.id === id) {
      return stamp({ ...address, id, createdAt: entry.createdAt }, new Date().toISOString());
    }
    // An explicit set-default must clear the old default before the
    // single-default pass, or first-wins would preserve the wrong entry.
    if (patch.isDefault === true) return { ...entry, isDefault: false };
    return entry;
  });
  const withDefault = updated.some((entry) => entry.isDefault)
    ? updated
    : updated.map((entry, index) => ({ ...entry, isDefault: index === 0 }));
  return { addresses: applySingleDefault(withDefault) };
}

export function deleteAddressEntry(book, id) {
  const remaining = normalizeAddressBook(book).filter((entry) => entry.id !== id);
  if (remaining.length === 0) return [];
  if (remaining.some((entry) => entry.isDefault)) return applySingleDefault(remaining);
  return remaining.map((entry, index) => ({ ...entry, isDefault: index === 0 }));
}

export function validateClaimedAddress(raw = {}, fallback = {}) {
  const legacy = raw && typeof raw === "object" ? raw : {};
  const candidate = {
    label: optionalText(legacy.label, 40) || "Home",
    recipient: optionalText(legacy.recipient || legacy.name || fallback.name, 120) || "Saved address",
    phone: normalizePhone(legacy.phone || legacy.mobile || fallback.phone),
    line1: optionalText(legacy.line1 || legacy.address),
    line2: optionalText(legacy.line2),
    landmark: optionalText(legacy.landmark),
    city: optionalText(legacy.city, 120),
    state: optionalText(legacy.state, 120),
    country: optionalText(legacy.country, 120) || "India",
    postalCode: text(legacy.postalCode || legacy.pincode).replace(/\D/g, ""),
    latitude: coordinate(legacy.latitude),
    longitude: coordinate(legacy.longitude),
    source: "claimed",
  };
  const errors = {};
  if (!candidate.line1) errors.line1 = "Enter house, street, or area.";
  if (!candidate.city) errors.city = "Enter city.";
  if (!candidate.state) errors.state = "Enter state.";
  if (!/^\d{6}$/.test(candidate.postalCode)) errors.postalCode = "Enter a 6-digit pincode.";
  if (candidate.phone) {
    const badPhone = phoneError(candidate.phone);
    if (badPhone) errors.phone = badPhone;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { address: candidate };
}

export function mergeClaimedAddresses(book, claimed, now = new Date().toISOString(), fallback = {}) {
  const merged = normalizeAddressBook(book);
  if (!Array.isArray(claimed)) return { addresses: merged, claimed: 0 };
  let claimedCount = 0;
  for (const raw of claimed) {
    if (merged.length >= MAX_SAVED_ADDRESSES) break;
    const { address, errors } = validateClaimedAddress(raw, fallback);
    if (errors) continue;
    merged.push(
      stamp(
        { ...address, id: randomUUID(), isDefault: merged.length === 0 },
        now
      )
    );
    claimedCount += 1;
  }
  return { addresses: applySingleDefault(merged), claimed: claimedCount };
}
