'use client';

import { Capabilities } from '../../../components/resources';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Capabilities {...useSection()} kind="skills" />;
}
