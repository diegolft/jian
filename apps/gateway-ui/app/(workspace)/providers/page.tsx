'use client';

import { Providers } from '../../../components/providers/index';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Providers {...useSection()} />;
}
