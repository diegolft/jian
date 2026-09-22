'use client';

import { Capabilities } from '../../../components/skills/index';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Capabilities {...useSection()} kind="mcpServers" />;
}
