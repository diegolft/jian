'use client';

import { Channels } from '../../../components/channels/index';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <Channels {...useSection()} />;
}
