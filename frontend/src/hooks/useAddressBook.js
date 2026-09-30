import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  claimAddresses,
  createAddress,
  deleteAddress,
  getAddresses,
  updateAddress,
} from "../services/storefront";

function readJSON(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export default function useAddressBook({ user, notify }) {
  const userKey = user?.email ? user.email.toLowerCase() : "guest";
  const selectionKey = `sf_current_address_${userKey}`;
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(() => readJSON(selectionKey, null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  async function safeRequest(promise, fallbackMessage) {
    try {
      return await promise;
    } catch {
      return { ok: false, data: { message: fallbackMessage } };
    }
  }

  const loadAddresses = useCallback(async (email) => {
    if (!email) {
      setAddresses([]);
      setSelectedAddressId(null);
      return [];
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    const { ok, data } = await safeRequest(getAddresses(), "Could not load saved addresses.");
    if (controller.signal.aborted) return [];
    if (!ok || !data.success) {
      setError(data.message || "Could not load saved addresses.");
      setLoading(false);
      return [];
    }
    const next = Array.isArray(data.addresses) ? data.addresses : [];
    setAddresses(next);
    setSelectedAddressId((current) => {
      if (current && next.some((entry) => entry.id === current)) return current;
      const fallback = next.find((entry) => entry.isDefault) || next[0];
      return fallback ? fallback.id : null;
    });
    setLoading(false);
    return next;
  }, []);

  const refresh = useCallback(() => loadAddresses(user?.email), [loadAddresses, user?.email]);

  useEffect(() => {
    setSelectedAddressId(readJSON(selectionKey, null));
  }, [selectionKey]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    writeJSON(selectionKey, selectedAddressId);
  }, [selectionKey, selectedAddressId]);

  const selectedAddress = useMemo(
    () => addresses.find((entry) => entry.id === selectedAddressId) || null,
    [addresses, selectedAddressId]
  );

  const mutate = useCallback(async (promise, successMessage) => {
    const { ok, data } = await safeRequest(promise, "Could not save this address.");
    if (!ok || !data.success) {
      notify(data.message || "Could not save this address.");
      return null;
    }
    const next = Array.isArray(data.addresses) ? data.addresses : [];
    setAddresses(next);
    setSelectedAddressId((current) => {
      if (current && next.some((entry) => entry.id === current)) return current;
      const fallback = next.find((entry) => entry.isDefault) || next[0];
      return fallback ? fallback.id : null;
    });
    if (successMessage) notify(successMessage);
    return next;
  }, [notify]);

  const selectAddress = useCallback((id) => setSelectedAddressId(id), []);
  const saveAddress = useCallback((payload) => mutate(createAddress(payload), "Address saved."), [mutate]);
  const editAddress = useCallback((id, patch) => mutate(updateAddress(id, patch), "Address updated."), [mutate]);
  const removeAddress = useCallback((id) => mutate(deleteAddress(id), "Address deleted."), [mutate]);

  const claimLegacyAddresses = useCallback(async (loginUser) => {
    const email = loginUser?.email || user?.email;
    let legacy = [];
    try {
      legacy = JSON.parse(localStorage.getItem("sf_addresses")) || [];
    } catch {
      legacy = [];
    }
    if (!email || !Array.isArray(legacy) || legacy.length === 0) return 0;
    const current = await loadAddresses(email);
    if (current.length > 0) return 0;
    const { ok, data } = await safeRequest(claimAddresses(legacy), "Could not import saved addresses.");
    if (ok && data.success) {
      const next = Array.isArray(data.addresses) ? data.addresses : [];
      setAddresses(next);
      try {
        localStorage.removeItem("sf_addresses");
      } catch {}
      const fallback = next.find((entry) => entry.isDefault) || next[0];
      if (fallback) setSelectedAddressId(fallback.id);
      notify(data.claimed ? `Imported ${data.claimed} saved address${data.claimed === 1 ? "" : "es"}.` : "Saved addresses imported.");
      return data.claimed || 0;
    }
    notify(data.message || "Could not import saved addresses.");
    return 0;
  }, [loadAddresses, notify, user?.email]);

  return {
    addresses,
    selectedAddress,
    selectedAddressId,
    loading,
    error,
    refresh,
    selectAddress,
    saveAddress,
    editAddress,
    removeAddress,
    claimLegacyAddresses,
  };
}
