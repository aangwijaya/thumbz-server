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

  async ensureProfile(sub: string): Promise<void> {
    await this.prisma.profile.upsert({
      where: { id: sub },
      update: {},
      create: { id: sub, role: 'user' },
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
