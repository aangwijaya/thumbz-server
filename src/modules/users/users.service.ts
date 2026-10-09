import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface UserProfile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  created_at: Date;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the profile on a user's first request. INSERT … ON CONFLICT DO
   * NOTHING is atomic: a new user's parallel first requests cannot race into
   * a unique violation (Prisma's upsert is find-then-create), and an existing
   * profile (e.g. an admin role) is never touched.
   */
  async ensureProfile(sub: string): Promise<void> {
    await this.prisma.profile.createMany({
      data: [{ id: sub, role: 'user' }],
      skipDuplicates: true,
    });
  }

  async getProfile(sub: string): Promise<UserProfile | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: sub },
    });
    if (profile === null) {
      return null;
    }
    const { id, username, avatar_url, role, created_at } = profile;
    return { id, username, avatar_url, role, created_at };
  }
}
