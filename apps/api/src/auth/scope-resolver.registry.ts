import { Injectable } from '@nestjs/common';

export type ScopeResolver = (id: string) => Promise<string | null>;

/**
 * Maps an entity type ("faculty", "course", …) to a function returning the institution that owns
 * an entity. Feature modules register resolvers on init; PermissionsGuard uses them.
 */
@Injectable()
export class ScopeResolverRegistry {
  private readonly resolvers = new Map<string, ScopeResolver>();

  register(entity: string, resolver: ScopeResolver): void {
    if (this.resolvers.has(entity))
      throw new Error(`Scope resolver for "${entity}" already registered`);
    this.resolvers.set(entity, resolver);
  }

  async resolve(entity: string, id: string): Promise<string | null> {
    const r = this.resolvers.get(entity);
    if (!r) throw new Error(`No scope resolver registered for "${entity}"`);
    return r(id);
  }
}
