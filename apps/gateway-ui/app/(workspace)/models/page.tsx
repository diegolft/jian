'use client';

import { ModelDefaults } from '../../../components/providers/model-defaults';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <ModelDefaults {...useSection()} />;
}
