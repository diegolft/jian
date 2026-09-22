import type { FastifyInstance } from 'fastify';
import { GatewayError } from '../core/errors.js';
import type { ProfileParams } from '../http/params.js';
import type { Skills } from './service.js';

type SkillRouteServices = { skills?: Skills };

function available(deps: SkillRouteServices): Skills {
  if (!deps.skills) {
    throw new GatewayError(503, 'Skill import is not configured');
  }

  return deps.skills;
}

export function registerSkillRoutes(app: FastifyInstance, deps: SkillRouteServices): void {
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/skill-catalog', async (request) =>
    available(deps).catalog(request.query),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/skills/import', async (request) =>
    available(deps).importSkill(request.params.profileId, request.body),
  );
}
