import { Module, type OnModuleInit } from '@nestjs/common';
import { AcademicStructureService, type AcademicEntityType } from '@cslp/server-core';
import { ScopeResolverRegistry } from '../auth/scope-resolver.registry.js';
import { AcademicStructureController } from './academic-structure.controller.js';
import { InstitutionsController } from './institutions.controller.js';

const ENTITIES: AcademicEntityType[] = [
  'faculty',
  'department',
  'programme',
  'level',
  'semester',
  'curriculumVersion',
];

@Module({ controllers: [InstitutionsController, AcademicStructureController] })
export class AcademicModule implements OnModuleInit {
  constructor(
    private readonly registry: ScopeResolverRegistry,
    private readonly academic: AcademicStructureService,
  ) {}

  onModuleInit() {
    for (const e of ENTITIES)
      this.registry.register(e, (id) => this.academic.resolveInstitutionId(e, id));
  }
}
