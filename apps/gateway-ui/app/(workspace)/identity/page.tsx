'use client';

import { ProfileEditor } from '../../../components/profile-editor';
import { useSection } from '../../../lib/workspace';

export default function Page() {
  return <ProfileEditor {...useSection()} />;
}
