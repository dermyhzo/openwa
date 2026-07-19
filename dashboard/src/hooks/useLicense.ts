import { useState, useEffect } from 'react';
import { licenseApi, type LicenseStatus } from '../services/api';

export interface UseLicenseResult extends LicenseStatus {
  loading: boolean;
}

export function useLicense(): UseLicenseResult {
  const [data, setData] = useState<LicenseStatus>({ active: false, tier: null, lifetime: false, expiresAt: null, issuedTo: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    licenseApi.getStatus()
      .then(setData)
      .catch(() => {/* backend enforces gating; silent fail is fine for UI hint */})
      .finally(() => setLoading(false));
  }, []);

  return { ...data, loading };
}
