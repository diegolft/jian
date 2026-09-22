import type {
  Checkpoint,
  GatewayEvent,
  Memory,
  Message,
  ModelDefaultsRecord,
  Profile,
  ProfileRevision,
  ProviderRecord,
  Run,
  Session,
} from '@elos/contracts';
import type { ChannelRecord, DeliveryRecord } from './channels/service.js';
import type { ConnectionRecord, DeviceAuthRecord, InboxRecord } from './channels/whatsapp/types.js';
import type { ArtifactRecord, LeaseRecord, MailRecord } from './coordination/service.js';
import type { AccessKeyRecord, CredentialRecord } from './security/credentials.js';

export type { GatewayEvent };

/** One entry per persisted record type. A new area is added here, and only here. */
export type Records = {
  profile: Profile;
  provider: ProviderRecord;
  modelDefault: ModelDefaultsRecord;
  revision: ProfileRevision;
  session: Session;
  message: Message;
  memory: Memory;
  run: Run;
  credential: CredentialRecord;
  accessKey: AccessKeyRecord;
  artifact: ArtifactRecord;
  lease: LeaseRecord;
  mail: MailRecord;
  channel: ChannelRecord;
  delivery: DeliveryRecord;
  checkpoint: Checkpoint;
  channelConnection: ConnectionRecord;
  channelAuth: DeviceAuthRecord;
  channelInbox: InboxRecord;
};

export type Kind = keyof Records;
