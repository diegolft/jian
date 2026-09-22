import {
  BookOpen,
  Cpu,
  Fingerprint,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Plug,
  Smartphone,
  Sparkles,
} from 'lucide-react';

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  group: 'workspace' | 'capabilities';
};

/** The sections of the panel, in the order the sidebar shows them. A section is a route. */
export const navigation: NavigationItem[] = [
  { href: '/', label: 'Visão geral', icon: LayoutDashboard, group: 'workspace' },
  { href: '/identity', label: 'Identidade', icon: Fingerprint, group: 'workspace' },
  { href: '/providers', label: 'Providers', icon: Plug, group: 'workspace' },
  { href: '/models', label: 'Modelos padrão', icon: Cpu, group: 'workspace' },
  { href: '/channels', label: 'Canais', icon: Smartphone, group: 'workspace' },
  { href: '/sessions', label: 'Sessões', icon: MessageSquare, group: 'workspace' },
  { href: '/memories', label: 'Memórias', icon: BookOpen, group: 'capabilities' },
  { href: '/skills', label: 'Skills', icon: Sparkles, group: 'capabilities' },
  { href: '/mcp', label: 'Servidores MCP', icon: Plug, group: 'capabilities' },
];

export const groupLabels = { workspace: 'Operação', capabilities: 'Capacidades' } as const;

/** The deepest section whose route prefixes the current one, so a child route stays marked. */
export function currentSection(pathname: string): NavigationItem | undefined {
  const path = pathname.replace(/\/$/, '') || '/';

  return [...navigation]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => path === item.href || path.startsWith(`${item.href}/`));
}
