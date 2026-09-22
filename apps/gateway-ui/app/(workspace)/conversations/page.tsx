'use client';

import { Sessions } from '../../../components/sessions';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Sessions {...useSection()} />;
}
