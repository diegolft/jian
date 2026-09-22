'use client';

import { ModelDefaults } from '../../../components/provider-settings';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <ModelDefaults {...useSection()} />;
}
