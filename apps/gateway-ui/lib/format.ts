/** How the panel writes values a person reads. Internationalization replaces the locale here. */

/** A textarea where one item per line, or per comma, is the natural way to type a list. */
export const lines = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

export const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
