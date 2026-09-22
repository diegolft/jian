'use client';

import { Providers } from '../../../components/provider-settings';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Providers {...useSection()} />;
}
