'use client';

import { Memories } from '../../../components/memories/index';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Memories {...useSection()} />;
}
