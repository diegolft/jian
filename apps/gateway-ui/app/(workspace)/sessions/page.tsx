'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Sessions } from '../../../components/sessions';
import { useSection } from '../../../lib/workspace';

function SessionHistory() {
  const session = useSearchParams().get('session') ?? undefined;
  return <Sessions key={session} {...useSection()} initialSession={session} />;
}
export default function Page() {
  return (
    <Suspense>
      <SessionHistory />
    </Suspense>
  );
}
