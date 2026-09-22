'use client';

import { Memories } from '../../../components/resources';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Memories {...useSection()} />;
}
