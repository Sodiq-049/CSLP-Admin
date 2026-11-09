import type { Permission } from '@cslp/shared-types';
import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarRange,
  ClipboardCheck,
  Coins,
  FileText,
  GraduationCap,
  Landmark,
  Layers,
  LayoutDashboard,
  Library,
  ListChecks,
  type LucideIcon,
  Network,
  Rocket,
  ScrollText,
  Settings,
  Sparkles,
  UserCog,
  Users,
  Video,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Phase that delivers the screen (docs/08). Undefined = available now. */
  phase?: number;
  /** Planned but not scheduled yet: shown as "Coming soon". */
  comingSoon?: boolean;
  permission?: Permission;
  description?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Sidebar from the brief §22. Later-phase screens are listed so the product shape is visible. */
export const NAV: NavGroup[] = [
  {
    label: 'Workspace',
    items: [{ label: 'Overview', href: '/', icon: LayoutDashboard }],
  },
  {
    label: 'Academic structure',
    items: [
      {
        label: 'Institutions',
        href: '/institutions',
        icon: Landmark,
        permission: 'institution.view',
      },
      {
        label: 'Faculties',
        href: '/structure/faculties',
        icon: Building2,
        permission: 'academic.view',
      },
      {
        label: 'Departments',
        href: '/structure/departments',
        icon: Network,
        permission: 'academic.view',
      },
      {
        label: 'Programmes',
        href: '/structure/programmes',
        icon: GraduationCap,
        permission: 'academic.view',
      },
      {
        label: 'Academic Levels',
        href: '/structure/levels',
        icon: Layers,
        permission: 'academic.view',
      },
      {
        label: 'Semesters',
        href: '/structure/semesters',
        icon: CalendarRange,
        permission: 'academic.view',
      },
      {
        label: 'Curricula',
        href: '/structure/curricula',
        icon: ScrollText,
        permission: 'academic.view',
      },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Courses', href: '/courses', icon: BookOpen, permission: 'course.view' },
      { label: 'Course Outlines', href: '/outlines', icon: FileText, permission: 'course.view' },
      { label: 'Source Library', href: '/sources', icon: Library, permission: 'content.view' },
      {
        label: 'AI Content Studio',
        href: '/studio',
        icon: Sparkles,
        permission: 'content.generate',
      },
      {
        label: 'AI Video Studio',
        href: '/video-studio',
        icon: Video,
        comingSoon: true,
        description:
          'Turn approved lessons into narrated, captioned videos with AI narration and on-screen slides and code.',
      },
      { label: 'Quiz Management', href: '/quizzes', icon: ListChecks, permission: 'content.view' },
      {
        label: 'Content Reviews',
        href: '/reviews',
        icon: ClipboardCheck,
        permission: 'content.review',
      },
      { label: 'Publishing Centre', href: '/publishing', icon: Rocket, permission: 'content.view' },
    ],
  },
  {
    label: 'People & insights',
    items: [
      {
        label: 'Students',
        href: '/students',
        icon: Users,
        permission: 'student.view',
        description: 'Student accounts, enrolments and progress.',
      },
      {
        label: 'Analytics',
        href: '/analytics',
        icon: BarChart3,
        permission: 'analytics.view',
        description: 'Engagement, completion and content performance.',
      },
      { label: 'AI Usage & Costs', href: '/ai-usage', icon: Coins, permission: 'ai_usage.view' },
      {
        label: 'Administrators',
        href: '/administrators',
        icon: UserCog,
        permission: 'admin_user.update',
      },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV.flatMap((g) => g.items).find(
    (i) => i.href !== '/' && (pathname === i.href || pathname.startsWith(`${i.href}/`)),
  );
}
