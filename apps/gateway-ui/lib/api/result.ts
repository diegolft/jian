/**
 * Turns a generated client call into its body, or into the sentence the owner should read. The
 * gateway answers in English; the panel is the only place that decides how a failure reads.
 */

/** The shapes the gateway uses for a failure body. Both fields are optional on purpose. */
type Detail = { error?: string; issues?: Array<{ path: string; message: string }> };

/** Conflicts the owner can act on. Anything else falls back to the generic 409 sentence. */
const conflicts: Record<string, string> = {
  'Choose a default model before starting a run':
    'Escolha um modelo padrão em Modelos padrão antes de conversar.',
  'This model does not accept the selected reasoning effort':
    'Este modelo não aceita o nível de esforço escolhido.',
  'Reasoning effort is not catalogued for this model':
    'O nível de esforço deste modelo não está catalogado no gateway.',
};

function message(status: number, detail: Detail | undefined): string {
  if (status === 401) {
    return 'Token inválido ou expirado. Entre novamente.';
  }

  if (status === 403) {
    return 'Esta ação exige o token de administrador.';
  }

  if (status === 409) {
    return (
      conflicts[detail?.error ?? ''] ??
      'O estado mudou ou a sessão está ocupada. Atualize e tente novamente.'
    );
  }

  if (status === 429) {
    return 'Limite de solicitações atingido. Aguarde um minuto antes de tentar novamente.';
  }

  if (detail?.issues?.length) {
    return `Confira os campos: ${detail.issues.map((issue) => issue.path).join(', ')}.`;
  }

  return detail?.error ?? `Não foi possível concluir a solicitação (${status}).`;
}

export async function result<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await request;

  if (!response.ok || data === undefined) {
    throw new Error(message(response.status, error as Detail | undefined));
  }

  return data;
}
