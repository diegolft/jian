'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

function LegacyRoute() {
  const router = useRouter();
  const query = useSearchParams();
  useEffect(() => {
    router.replace(`/sessions${query.size ? `?${query}` : ''}`);
  }, [router, query]);
  return null;
}
export default function Page() {
  return (
    <Suspense>
      <LegacyRoute />
    </Suspense>
  );
}
