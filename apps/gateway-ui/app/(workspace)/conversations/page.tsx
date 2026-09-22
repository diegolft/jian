'use client';

import { Sessions } from '../../../components/conversations/index';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Sessions {...useSection()} />;
}
