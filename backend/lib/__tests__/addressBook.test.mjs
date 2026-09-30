import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SAVED_ADDRESSES,
  createAddressEntry,
  deleteAddressEntry,
  mergeClaimedAddresses,
  normalizeAddressBook,
  updateAddressEntry,
  validateAddressInput,
} from "../addressBook.js";

const valid = {
  label: "Home",
  recipient: "Anita Sharma",
  phone: "9876543210",
  line1: "12, Nehru Road",
  line2: "Near Post Office",
  landmark: "Opposite park",
  city: "Pune",
  state: "Maharashtra",
  country: "India",
  postalCode: "411001",
  latitude: 18.5204,
  longitude: 73.8567,
  source: "manual",
};

test("legacy non-array storage becomes an empty address book", () => {
  assert.deepEqual(normalizeAddressBook({}), []);
  assert.deepEqual(normalizeAddressBook(null), []);
});

test("the first saved address is forced to default", () => {
  const { address, error } = createAddressEntry([], valid, "2026-09-30T00:00:00.000Z");
  assert.equal(error, undefined);
  assert.equal(address.isDefault, true);
  assert.equal(typeof address.id, "string");
});

test("the book rejects an eleventh address", () => {
  const book = Array.from({ length: MAX_SAVED_ADDRESSES }, (_, index) => ({
    ...valid,
    id: `address-${index + 1}`,
    isDefault: index === 0,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  }));
  const result = createAddressEntry(book, valid);
  assert.match(result.error, /up to 10 addresses/);
});

test("setting a default clears the old default", () => {
  const first = createAddressEntry([], valid).address;
  const second = createAddressEntry([first], { ...valid, label: "Work" }).address;
  const { addresses, error } = updateAddressEntry([first, second], second.id, { isDefault: true });
  assert.equal(error, undefined);
  assert.deepEqual(addresses.map((entry) => entry.isDefault), [false, true]);
});

test("deleting the default promotes the next remaining address", () => {
  const first = createAddressEntry([], valid).address;
  const second = createAddressEntry([first], { ...valid, label: "Work" }).address;
  const addresses = deleteAddressEntry([first, second], first.id);
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].id, second.id);
  assert.equal(addresses[0].isDefault, true);
});

test("legacy geography-only records are claimed with the account fallback", () => {
  const claimed = [
    { address: "12, Nehru Road", city: "Pune", state: "Maharashtra", pincode: "411001" },
    { line1: "", city: "Pune", state: "Maharashtra", postalCode: "411001" },
  ];
  const result = mergeClaimedAddresses([], claimed, "2026-09-30T00:00:00.000Z", { name: "Anita Sharma" });
  assert.equal(result.claimed, 1);
  assert.equal(result.addresses.length, 1);
  assert.equal(result.addresses[0].source, "claimed");
  assert.equal(result.addresses[0].postalCode, "411001");
  assert.equal(result.addresses[0].recipient, "Anita Sharma");
});

test("E.164 numbers from the country-code picker validate and keep their +", () => {
  const { address, errors } = validateAddressInput({ ...valid, phone: "+91 98765 43210" });
  assert.equal(errors, undefined);
  assert.equal(address.phone, "+919876543210");
});

test("address pincode and phone validation reject malformed values", () => {
  const result = validateAddressInput({ ...valid, postalCode: "4110", phone: "123" });
  assert.equal(result.address, undefined);
  assert.equal(result.errors.postalCode, "Enter a 6-digit pincode.");
  assert.equal(result.errors.phone, "Enter a valid mobile number.");
});
